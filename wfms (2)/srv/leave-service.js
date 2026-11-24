/**
 * wfms/srv/leave-service.js
 *
 * Leave request lifecycle: create validation, submit, approve (with team
 * coverage check), reject, send back, cancel. Every transition mutates
 * balance + status inside the same cds transaction and writes an audit row.
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const calc = require('./lib/calculations');
const { writeAudit, writeApprovalHistory, userId, currentEmployeeId } = require('./lib/audit');

module.exports = (srv) => {

        /* ---------------- CREATE validation ---------------- */
        srv.before('CREATE', 'LeaveRequests', async (req) => {
            const tx = cds.tx(req);
            const data = req.data;
            const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: data.employee_ID }));
            if (!emp) return req.error(404, `Employee not found`);
            if (emp.status !== 'Active') return req.error(400, `Employee is not active`);

            const lt = await tx.run(SELECT.one.from('wfms.LeaveTypes').where({ ID: data.leaveType_ID }));
            if (!lt) return req.error(404, `Leave type not found`);

            if (new Date(data.endDate) < new Date(data.startDate)) {
                return req.error(400, `endDate must be on or after startDate`);
            }

            // duplicate / overlap
            if (await calc.hasOverlappingLeave(tx, data.employee_ID, data.startDate, data.endDate)) {
                return req.error(409, `An overlapping leave request already exists for this period.`);
            }

            // working days
            const days = await calc.calcLeaveDays(tx, data.employee_ID, data.leaveType_ID, data.startDate, data.endDate, data.isHalfDay);
            data.days = Number(days);

            // blackout (sick leave exempt)
            if (!lt.exemptFromBlackout) {
                const blk = await calc.blackoutHit(tx, emp, data.startDate, data.endDate, lt.code);
                if (blk) {
                    return req.error(422, `Leave blocked by blackout period "${blk.name}" (${blk.startDate} to ${blk.endDate}). ${blk.reason || ''}`);
                }
            }

            // advance notice (sick leave exempt)
            const notice = await calc.checkAdvanceNotice(tx, emp, lt, data.startDate, data.endDate, days);
            if (!notice.ok) return req.error(422, notice.message);

            // medical certificate for sick leave > threshold consecutive calendar days
            if (calc.requiresMedicalCertificate(lt, calendarDays(data.startDate, data.endDate))) {
                const hasAttachment = await tx.run(SELECT.one.from('wfms.LeaveAttachments').where({ leaveRequest_ID: data.ID }));
                if (!hasAttachment) {
                    return req.error(422, `Sick leave exceeding ${lt.requireCertificateAfterDays} consecutive calendar days requires a medical certificate attachment.`);
                }
            }

            // balance
            const balCheck = await calc.checkLeaveBalance(tx, data.employee_ID, data.leaveType_ID, days);
            if (!balCheck.ok) return req.error(422, balCheck.message);

            data.status = 'Draft';
            data.blackoutExempt = lt.exemptFromBlackout;
        });

        /* ---------------- submitLeaveRequest ---------------- */
        srv.on('submitLeaveRequest', async (req) => {
            const tx = cds.tx(req);
            const lr = await tx.run(SELECT.one.from('wfms.LeaveRequests').where({ ID: req.data.ID }));
            if (!lr) return req.error(404, 'Leave request not found');
            if (lr.status !== 'Draft' && lr.status !== 'SentBack') {
                return req.error(409, `Cannot submit a request in status ${lr.status}`);
            }
            const lt = await tx.run(SELECT.one.from('wfms.LeaveTypes').where({ ID: lr.leaveType_ID }));

            // re-validate balance + overlap (paranoid)
            const days = await calc.calcLeaveDays(tx, lr.employee_ID, lr.leaveType_ID, lr.startDate, lr.endDate, lr.isHalfDay);
            const balCheck = await calc.checkLeaveBalance(tx, lr.employee_ID, lr.leaveType_ID, days);
            if (!balCheck.ok) return req.error(422, balCheck.message);
            if (await calc.hasOverlappingLeave(tx, lr.employee_ID, lr.startDate, lr.endDate, lr.ID)) {
                return req.error(409, 'Overlapping leave request detected on submit.');
            }
            if (!lt.exemptFromBlackout) {
                const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: lr.employee_ID }));
                const blk = await calc.blackoutHit(tx, emp, lr.startDate, lr.endDate, lt.code);
                if (blk) return req.error(422, `Leave blocked by blackout period "${blk.name}".`);
            }

            // increment pending balance
            await calc.applyBalanceDelta(tx, lr.employee_ID, lr.leaveType_ID, new Date(lr.startDate).getFullYear(), { pending: Number(days), available: -Number(days) });

            await tx.run(UPDATE('wfms.LeaveRequests').set({ status: 'PendingManager' }).where({ ID: lr.ID }));
            await writeApprovalHistory(tx, 'LeaveRequest', lr.ID, userId(req), 'Submitted', 'Submitted', lr.requestorComments);
            await writeAudit(tx, req, 'LeaveSubmit', 'LeaveRequest', lr.ID, { status: lr.status }, { status: 'PendingManager', days }, 'Leave submitted');
            return {};
        });

        /* ---------------- approveLeaveRequest ---------------- */
        srv.on('approveLeaveRequest', async (req) => {
            const tx = cds.tx(req);
            const { ID, comments, coverageOverride, coverageOverrideReason } = req.data;
            const lr = await tx.run(SELECT.one.from('wfms.LeaveRequests').where({ ID }));
            if (!lr) return req.error(404, 'Leave request not found');
            if (lr.status !== 'PendingManager') return req.error(409, `Cannot approve a request in status ${lr.status}`);

            // team coverage validation
            const cov = await calc.previewTeamCoverage(tx, lr.ID);
            if (cov.pct < cov.minPct) {
                if (!coverageOverride || !coverageOverrideReason) {
                    return req.error(422, `Team coverage would drop to ${cov.pct}% (minimum ${cov.minPct}%). A documented override is required.`);
                }
                await writeAudit(tx, req, 'CoverageOverride', 'LeaveRequest', lr.ID, { coveragePct: cov.pct }, { overrideReason: coverageOverrideReason }, 'Coverage override applied on approval');
            }

            // balance: move pending -> used
            const days = Number(lr.days);
            await calc.applyBalanceDelta(tx, lr.employee_ID, lr.leaveType_ID, new Date(lr.startDate).getFullYear(), { pending: -days, used: days });

            await tx.run(UPDATE('wfms.LeaveRequests').set({
                status: 'Approved', approverComments: comments,
                coverageOverrideApplied: !!coverageOverride, coverageOverrideReason: coverageOverrideReason || '',
                approvedAt: new Date().toISOString(),
                approver_ID: await currentEmployeeId(tx, req)
            }).where({ ID }));

            await writeApprovalHistory(tx, 'LeaveRequest', lr.ID, userId(req), 'Approved', 'Approved', comments);
            await writeAudit(tx, req, 'LeaveApprove', 'LeaveRequest', lr.ID, { status: 'PendingManager' }, { status: 'Approved', days, coveragePct: cov.pct }, comments);
            return {};
        });

        /* ---------------- reject / send back / cancel ---------------- */
        srv.on('rejectLeaveRequest', async (req) => {
            const tx = cds.tx(req);
            const lr = await tx.run(SELECT.one.from('wfms.LeaveRequests').where({ ID: req.data.ID }));
            if (!lr) return req.error(404, 'Leave request not found');
            if (lr.status === 'Approved') return req.error(409, 'Cannot reject an already-approved request');
            if (lr.status === 'PendingManager') {
                await calc.applyBalanceDelta(tx, lr.employee_ID, lr.leaveType_ID, new Date(lr.startDate).getFullYear(), { pending: -Number(lr.days), available: Number(lr.days) });
            }
            await tx.run(UPDATE('wfms.LeaveRequests').set({ status: 'Rejected', approverComments: req.data.comments }).where({ ID: lr.ID }));
            await writeApprovalHistory(tx, 'LeaveRequest', lr.ID, userId(req), 'Rejected', 'Rejected', req.data.comments);
            await writeAudit(tx, req, 'LeaveReject', 'LeaveRequest', lr.ID, { status: lr.status }, { status: 'Rejected' }, req.data.comments);
            return {};
        });

        srv.on('sendBackLeaveRequest', async (req) => {
            const tx = cds.tx(req);
            const lr = await tx.run(SELECT.one.from('wfms.LeaveRequests').where({ ID: req.data.ID }));
            if (!lr) return req.error(404, 'Leave request not found');
            if (lr.status !== 'PendingManager') return req.error(409, `Cannot send back a request in status ${lr.status}`);
            await tx.run(UPDATE('wfms.LeaveBalances')
                .set `pending = pending - ${Number(lr.days)}, available = available + ${Number(lr.days)}`
                .where `employee_ID = ${lr.employee_ID} and leaveType_ID = ${lr.leaveType_ID} and year = ${new Date(lr.startDate).getFullYear()}`);
            await tx.run(UPDATE('wfms.LeaveRequests').set({ status: 'SentBack', approverComments: req.data.comments }).where({ ID: lr.ID }));
            await writeApprovalHistory(tx, 'LeaveRequest', lr.ID, userId(req), 'SentBack', 'SentBack', req.data.comments);
            await writeAudit(tx, req, 'LeaveSendBack', 'LeaveRequest', lr.ID, { status: lr.status }, { status: 'SentBack' }, req.data.comments);
            return {};
        });

        srv.on('cancelLeaveRequest', async (req) => {
            const tx = cds.tx(req);
            const lr = await tx.run(SELECT.one.from('wfms.LeaveRequests').where({ ID: req.data.ID }));
            if (!lr) return req.error(404, 'Leave request not found');
            if (['Approved', 'Rejected', 'Cancelled'].includes(lr.status)) {
                return req.error(409, `Cannot cancel a request in status ${lr.status}`);
            }
            if (lr.status === 'PendingManager') {
                await calc.applyBalanceDelta(tx, lr.employee_ID, lr.leaveType_ID, new Date(lr.startDate).getFullYear(), { pending: -Number(lr.days), available: Number(lr.days) });
            }
            await tx.run(UPDATE('wfms.LeaveRequests').set({ status: 'Cancelled' }).where({ ID: lr.ID }));
            await writeApprovalHistory(tx, 'LeaveRequest', lr.ID, userId(req), 'Cancelled', 'Cancelled', 'Cancelled by user');
            await writeAudit(tx, req, 'LeaveCancel', 'LeaveRequest', lr.ID, { status: lr.status }, { status: 'Cancelled' }, 'Cancelled');
            return {};
        });

        /* ---------------- exposed calculation functions ---------------- */
        srv.on('calcLeaveDays', async (req) => {
            const tx = cds.tx(req);
            const { employee_ID, leaveType_ID, startDate, endDate, isHalfDay } = req.data;
            return await calc.calcLeaveDays(tx, employee_ID, leaveType_ID, startDate, endDate, isHalfDay);
        });

        srv.on('previewTeamCoverage', async (req) => {
            const tx = cds.tx(req);
            const cov = await calc.previewTeamCoverage(tx, req.data.leaveRequest_ID);
            return cov.pct;
        });
};

function calendarDays(start, end) {
    const s = new Date(start); const e = new Date(end);
    return Math.round((e - s) / 86400000) + 1;
}
