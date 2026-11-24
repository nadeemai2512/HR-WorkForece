/**
 * wfms/srv/overtime-service.js
 *
 * Overtime lifecycle: create validation (overlap + compliance + amount calc),
 * submit, approve (writes WorkHours + optional CompOff), reject, send back,
 * cancel. All amount and credit calculations run server-side and are
 * materialized on the request row for audit + payroll export.
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const calc = require('./lib/calculations');
const { writeAudit, writeApprovalHistory, userId, currentEmployeeId } = require('./lib/audit');

module.exports = (srv) => {

        /* ---------------- CREATE: compute + validate ---------------- */
        srv.before('CREATE', 'OvertimeRequests', async (req) => {
            const tx = cds.tx(req);
            const data = req.data;
            const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: data.employee_ID }));
            if (!emp) return req.error(404, 'Employee not found');
            if (emp.status !== 'Active') return req.error(400, 'Employee is not active');

            if (!data.overtimeStart || !data.overtimeEnd) return req.error(400, 'overtimeStart and overtimeEnd are required');
            const minutes = calc.durationMinutes(data.overtimeStart, data.overtimeEnd);
            if (minutes <= 0) return req.error(400, 'overtimeEnd must be after overtimeStart (or overnight).');

            // compute type / multiplier / amount via shared lib
            const computed = JSON.parse(await calc.calcOvertime(tx, data.employee_ID, data.workDate, data.overtimeStart, data.overtimeEnd));
            data.overtimeMinutes = computed.minutes;
            data.overtimeType = computed.type;
            data.multiplier = computed.multiplier;
            data.baseHourlyRate = computed.baseHourlyRate;
            data.estimatedAmount = computed.estimatedAmount;
            data.compOffCreditsEarned = data.compOffElection === 'CompOff' || data.compOffElection === 'Split'
                ? computed.compOffCredits : 0;

            // overlap warnings
            const overlapWarnings = await calc.checkOvertimeOverlap(tx, emp, data.workDate, data.overtimeStart, data.overtimeEnd);
            data.overlapWarning = overlapWarnings.join(' ');

            // compliance (only block hard errors at create; warnings persisted)
            const comp = await calc.checkOvertimeCompliance(tx, emp, data.workDate, minutes);
            if (!comp.ok) return req.error(422, comp.error);
            data.complianceWarning = comp.warnings.join(' ');

            // regular shift minutes materialized if provided
            if (data.regularShiftStart && data.regularShiftEnd) {
                data.regularShiftMinutes = calc.durationMinutes(data.regularShiftStart, data.regularShiftEnd);
            }

            data.status = 'Draft';
        });

        /* ---------------- submitOvertime ---------------- */
        srv.on('submitOvertime', async (req) => {
            const tx = cds.tx(req);
            const o = await tx.run(SELECT.one.from('wfms.OvertimeRequests').where({ ID: req.data.ID }));
            if (!o) return req.error(404, 'Overtime request not found');
            if (o.status !== 'Draft' && o.status !== 'SentBack') return req.error(409, `Cannot submit overtime in status ${o.status}`);

            const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: o.employee_ID }));
            // re-check compliance + overlap on submit
            const comp = await calc.checkOvertimeCompliance(tx, emp, o.workDate, o.overtimeMinutes);
            if (!comp.ok) return req.error(422, comp.error);
            const overlap = await calc.checkOvertimeOverlap(tx, emp, o.workDate, o.overtimeStart, o.overtimeEnd, o.ID);
            if (overlap.length) {
                // overlap with another OT is a hard block; overlap with leave/shift is a warning persisted
                const hardBlock = overlap.find(w => w.includes('existing overtime request'));
                if (hardBlock) return req.error(409, hardBlock);
                await tx.run(UPDATE('wfms.OvertimeRequests').set({ overlapWarning: overlap.join(' '), complianceWarning: comp.warnings.join(' ') }).where({ ID: o.ID }));
            }

            await tx.run(UPDATE('wfms.OvertimeRequests').set({ status: 'PendingManager' }).where({ ID: o.ID }));
            await writeApprovalHistory(tx, 'OvertimeRequest', o.ID, userId(req), 'Submitted', 'Submitted', o.requestorComments);
            await writeAudit(tx, req, 'OvertimeSubmit', 'OvertimeRequest', o.ID, { status: o.status }, { status: 'PendingManager', minutes: o.overtimeMinutes, amount: o.estimatedAmount }, 'Overtime submitted');
            return {};
        });

        /* ---------------- approveOvertime ---------------- */
        srv.on('approveOvertime', async (req) => {
            const tx = cds.tx(req);
            const o = await tx.run(SELECT.one.from('wfms.OvertimeRequests').where({ ID: req.data.ID }));
            if (!o) return req.error(404, 'Overtime request not found');
            if (o.status !== 'PendingManager') return req.error(409, `Cannot approve overtime in status ${o.status}`);

            const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: o.employee_ID }));
            // final compliance re-check before approving
            const comp = await calc.checkOvertimeCompliance(tx, emp, o.workDate, o.overtimeMinutes);
            if (!comp.ok) return req.error(422, comp.error);

            // upsert EmployeeWorkHours row for the day
            const existingWh = await tx.run(SELECT.one.from('wfms.EmployeeWorkHours').where `employee_ID = ${o.employee_ID} and workDate = ${o.workDate}`);
            if (existingWh) {
                await tx.run(UPDATE('wfms.EmployeeWorkHours').set({
                    overtimeMinutes: (existingWh.overtimeMinutes || 0) + o.overtimeMinutes,
                    totalMinutes: (existingWh.regularMinutes || 0) + (existingWh.overtimeMinutes || 0) + o.overtimeMinutes,
                    source: 'Approved'
                    // overtimeRequest_ID intentionally NOT overwritten: a day can have
                    // multiple approved OT rows; keep the link to the first one.
                }).where({ ID: existingWh.ID }));
            } else {
                const regularMinutes = o.regularShiftMinutes || 8 * 60;
                await tx.run(INSERT.into('wfms.EmployeeWorkHours').entries({
                    employee_ID: o.employee_ID, workDate: o.workDate,
                    regularMinutes, overtimeMinutes: o.overtimeMinutes,
                    totalMinutes: regularMinutes + o.overtimeMinutes, source: 'Approved',
                    overtimeRequest_ID: o.ID
                }));
            }

            // Comp-Off credit transaction if elected
            if (o.compOffCreditsEarned > 0 && (o.compOffElection === 'CompOff' || o.compOffElection === 'Split')) {
                const otHours = Number(o.overtimeMinutes) / 60;
                const lastTxn = await tx.run(SELECT.one.from('wfms.CompOffTransactions').where `employee_ID = ${o.employee_ID}`.orderBy `earnedAt desc`);
                // CompOffTransactions is denominated in HOURS (not credits/days); the
                // OvertimeRequest.compOffCreditsEarned field stays in credits for display.
                const newBalance = (lastTxn ? Number(lastTxn.balance) : 0) + otHours;
                await tx.run(INSERT.into('wfms.CompOffTransactions').entries({
                    employee_ID: o.employee_ID, sourceOvertime_ID: o.ID, type: 'Earned',
                    hoursEarned: otHours, hoursUsed: 0, balance: newBalance,
                    earnedAt: new Date().toISOString(),
                    comments: `Earned ${otHours}h comp-off from OT on ${o.workDate}`
                }));
            }

            await tx.run(UPDATE('wfms.OvertimeRequests').set({
                status: 'Approved', approverComments: req.data.comments,
                approvedAt: new Date().toISOString(),
                approver_ID: await currentEmployeeId(tx, req)
            }).where({ ID: o.ID }));
            await writeApprovalHistory(tx, 'OvertimeRequest', o.ID, userId(req), 'Approved', 'Approved', req.data.comments);
            await writeAudit(tx, req, 'OvertimeApprove', 'OvertimeRequest', o.ID,
                { status: 'PendingManager' }, { status: 'Approved', minutes: o.overtimeMinutes, amount: o.estimatedAmount, compOff: o.compOffCreditsEarned }, req.data.comments);
            return {};
        });

        /* ---------------- reject / send back / cancel ---------------- */
        srv.on('rejectOvertime', async (req) => {
            const tx = cds.tx(req);
            const o = await tx.run(SELECT.one.from('wfms.OvertimeRequests').where({ ID: req.data.ID }));
            if (!o) return req.error(404, 'Overtime request not found');
            if (o.status === 'Approved') return req.error(409, 'Cannot reject an already-approved request');
            await tx.run(UPDATE('wfms.OvertimeRequests').set({ status: 'Rejected', approverComments: req.data.comments }).where({ ID: o.ID }));
            await writeApprovalHistory(tx, 'OvertimeRequest', o.ID, userId(req), 'Rejected', 'Rejected', req.data.comments);
            await writeAudit(tx, req, 'OvertimeReject', 'OvertimeRequest', o.ID, { status: o.status }, { status: 'Rejected' }, req.data.comments);
            return {};
        });

        srv.on('sendBackOvertime', async (req) => {
            const tx = cds.tx(req);
            const o = await tx.run(SELECT.one.from('wfms.OvertimeRequests').where({ ID: req.data.ID }));
            if (!o) return req.error(404, 'Overtime request not found');
            if (o.status !== 'PendingManager') return req.error(409, `Cannot send back overtime in status ${o.status}`);
            await tx.run(UPDATE('wfms.OvertimeRequests').set({ status: 'SentBack', approverComments: req.data.comments }).where({ ID: o.ID }));
            await writeApprovalHistory(tx, 'OvertimeRequest', o.ID, userId(req), 'SentBack', 'SentBack', req.data.comments);
            await writeAudit(tx, req, 'OvertimeSendBack', 'OvertimeRequest', o.ID, { status: o.status }, { status: 'SentBack' }, req.data.comments);
            return {};
        });

        srv.on('cancelOvertime', async (req) => {
            const tx = cds.tx(req);
            const o = await tx.run(SELECT.one.from('wfms.OvertimeRequests').where({ ID: req.data.ID }));
            if (!o) return req.error(404, 'Overtime request not found');
            if (['Approved', 'Rejected', 'Cancelled'].includes(o.status)) return req.error(409, `Cannot cancel overtime in status ${o.status}`);
            await tx.run(UPDATE('wfms.OvertimeRequests').set({ status: 'Cancelled' }).where({ ID: o.ID }));
            await writeApprovalHistory(tx, 'OvertimeRequest', o.ID, userId(req), 'Cancelled', 'Cancelled', 'Cancelled by user');
            await writeAudit(tx, req, 'OvertimeCancel', 'OvertimeRequest', o.ID, { status: o.status }, { status: 'Cancelled' }, 'Cancelled');
            return {};
        });

        /* ---------------- exposed calcOvertime function ---------------- */
        srv.on('calcOvertime', async (req) => {
            const tx = cds.tx(req);
            const { employee_ID, workDate, otStart, otEnd } = req.data;
            return await calc.calcOvertime(tx, employee_ID, workDate, otStart, otEnd);
        });
};
