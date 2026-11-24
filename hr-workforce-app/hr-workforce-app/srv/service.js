'use strict';
/**
 * HRService — CAP service implementation.
 *
 * Wires the reusable lib helpers (leave, overtime, coverage, rest period, audit,
 * auth) into bound actions, unbound dashboard functions, and READ/CREATE hooks
 * that enforce instance-based authorization on the backend.
 *
 * A single OData request runs inside one CAP transaction, so multi-record
 * operations (approval + balance deduction + audit + comp-off + work hours)
 * either commit atomically or roll back on any error.
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT, DELETE } = cds.ql;

const leaveCalc = require('./lib/leaveCalc');
const overtime = require('./lib/overtimeCalc');
const coverage = require('./lib/coverage');
const rest = require('./lib/restPeriod');
const { writeAudit } = require('./lib/audit');
const auth = require('./lib/auth');

const APPROVAL_ENTITY = { LEAVE: 'LeaveRequests', OVERTIME: 'OvertimeRequests', SWAP: 'ShiftSwapRequests' };

module.exports = class HRService extends cds.ApplicationService {
    async init() {
        const srv = this;

        /* ============================================================
         * READ enforcement — instance-based row filtering
         * ========================================================== */
        const SELF_ENTITIES = {
            LeaveRequests: 'employeeNo',
            OvertimeRequests: 'employeeNo',
            ShiftAssignments: 'employeeNo',
            ShiftSwapRequests: 'requestor',   // resolved manually below
            LeaveBalances: null,              // via employee_ID, resolved manually
            EmployeeWorkHours: null,
            CompOffTransactions: null,
        };

        for (const entity of Object.keys(SELF_ENTITIES)) {
            srv.before('READ', entity, async (req) => {
                if (!req.query.SELECT) return;
                const role = auth.roleCategory(req);
                if (role === 'HR_ADMIN') return; // unrestricted
                const me = auth.currentEmployeeNo(req);
                if (!me) { req.reject(401, 'No employee identity on the request.'); return; }
                if (role === 'EMPLOYEE') {
                    if (entity === 'LeaveBalances' || entity === 'EmployeeWorkHours' || entity === 'CompOffTransactions') {
                        req.query.where('employee_ID =', me);
                    } else if (entity === 'ShiftSwapRequests') {
                        req.query.where('requestor_ID =', me);
                    } else {
                        req.query.where('employeeNo =', me);
                    }
                    return;
                }
                if (role === 'MANAGER') {
                    const team = await auth.teamMemberIds(srv, me);
                    const ids = [me, ...team.map(t => t.employeeNo)];
                    if (entity === 'LeaveBalances' || entity === 'EmployeeWorkHours' || entity === 'CompOffTransactions') {
                        req.query.where('employee_ID in', ids);
                    } else if (entity === 'ShiftSwapRequests') {
                        req.query.where('requestor_ID in', ids);
                    } else {
                        req.query.where('employeeNo in', ids);
                    }
                }
            });
        }

        /* Employees: employees see self, managers see team, HR sees all */
        srv.before('READ', 'Employees', async (req) => {
            if (!req.query.SELECT) return;
            const role = auth.roleCategory(req);
            if (role === 'HR_ADMIN') return;
            const me = auth.currentEmployeeNo(req);
            if (role === 'EMPLOYEE') { req.query.where('employeeNo =', me); return; }
            if (role === 'MANAGER') {
                const team = await auth.teamMemberIds(srv, me);
                req.query.where('employeeNo in', [me, ...team.map(t => t.employeeNo)]);
            }
        });

        /* ============================================================
         * Leave Requests — bound actions
         * ========================================================== */
        srv.on('recalcDays', 'LeaveRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const lr = await cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
            if (!lr) req.reject(404, 'Leave request not found.');
            const r = await leaveCalc.calculateLeaveDays(srv, {
                employeeNo: lr.employeeNo, leaveTypeCode: lr.leaveType_code,
                startDate: lr.startDate, endDate: lr.endDate,
            });
            await srv.run(UPDATE('LeaveRequests').set({
                days: r.workingDays, medicalCertRequired: r.medicalCertRequired,
            }).where({ ID: id }));
            return cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
        });

        srv.on('submit', 'LeaveRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const lr = await cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
            if (!lr) req.reject(404, 'Leave request not found.');
            await auth.assertCanAccessEmployee(srv, req, lr.employeeNo);

            const calc = await leaveCalc.calculateLeaveDays(srv, {
                employeeNo: lr.employeeNo, leaveTypeCode: lr.leaveType_code,
                startDate: lr.startDate, endDate: lr.endDate,
            });
            if (calc.isBlocked) {
                req.reject(400, `Leave cannot be submitted: ${calc.messages}`);
            }
            const days = calc.workingDays;
            await srv.run(UPDATE('LeaveRequests').set({
                status: 'PENDING_MANAGER', days,
                medicalCertRequired: calc.medicalCertRequired,
            }).where({ ID: id }));
            lr.days = days;
            await leaveCalc.reservePending(srv, lr);
            await writeAudit(srv, {
                userId: auth.userId(req), action: 'LEAVE_SUBMITTED', entityType: 'LeaveRequest', entityId: id,
                prevValue: 'DRAFT', newValue: 'PENDING_MANAGER',
                reason: `${lr.leaveType_code} ${lr.startDate}->${lr.endDate} (${days}d)`,
            });
            await addApprovalHistory(srv, 'LEAVE', id, req, 'SUBMITTED', 'DRAFT', 'PENDING_MANAGER', 'Submitted by employee');
            return cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
        });

        srv.on('approve', 'LeaveRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const comment = req.data.comment;
            const lr = await cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
            if (!lr) req.reject(404, 'Leave request not found.');
            if (!['PENDING_MANAGER', 'SENT_BACK'].includes(lr.status)) req.reject(400, `Cannot approve a request in status ${lr.status}.`);

            // Coverage check before approval
            const cov = await coverage.evaluateCoverage(srv, {
                departmentCode: lr.department_code, startDate: lr.startDate, endDate: lr.endDate,
                excludeRequestId: id,
            });
            let overrideApplied = lr.coverageOverrideApplied;
            if (cov.belowThreshold && !overrideApplied) {
                req.reject(400, `Cannot approve: ${cov.message} Apply a documented coverage override first.`);
            }
            await srv.run(UPDATE('LeaveRequests').set({
                status: 'APPROVED', approver_ID: auth.currentEmployeeNo(req),
                managerComment: comment || '', coverageOverrideApplied: overrideApplied,
            }).where({ ID: id }));
            await leaveCalc.consumeApproved(srv, lr); // pending -> used
            await writeAudit(srv, {
                userId: auth.userId(req), action: 'LEAVE_APPROVED', entityType: 'LeaveRequest', entityId: id,
                prevValue: lr.status, newValue: 'APPROVED', reason: comment || 'Approved by manager',
            });
            await addApprovalHistory(srv, 'LEAVE', id, req, 'APPROVED', lr.status, 'APPROVED', comment);
            return cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
        });

        srv.on('rejectRequest', 'LeaveRequests', async (req) => {
            return rejectLeave(srv, req, 'REJECTED', req.data.comment);
        });
        srv.on('sendBack', 'LeaveRequests', async (req) => {
            return rejectLeave(srv, req, 'SENT_BACK', req.data.comment);
        });

        srv.on('cancel', 'LeaveRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const lr = await cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
            if (!lr) req.reject(404, 'Leave request not found.');
            await auth.assertCanAccessEmployee(srv, req, lr.employeeNo);
            if (lr.status === 'APPROVED') req.reject(400, 'Cannot cancel an already-approved request; contact HR.');
            await srv.run(UPDATE('LeaveRequests').set({ status: 'CANCELLED' }).where({ ID: id }));
            if (['SUBMITTED', 'PENDING_MANAGER'].includes(lr.status)) await leaveCalc.releasePending(srv, lr);
            await writeAudit(srv, { userId: auth.userId(req), action: 'LEAVE_CANCELLED', entityType: 'LeaveRequest', entityId: id, prevValue: lr.status, newValue: 'CANCELLED', reason: 'Cancelled by owner' });
            await addApprovalHistory(srv, 'LEAVE', id, req, 'CANCELLED', lr.status, 'CANCELLED', 'Cancelled by owner');
            return cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
        });

        srv.on('applyCoverageOverride', 'LeaveRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const reason = req.data.reason;
            const role = auth.roleCategory(req);
            if (role !== 'HR_ADMIN' && role !== 'MANAGER') req.reject(403, 'Only managers or HR can apply a coverage override.');
            await srv.run(UPDATE('LeaveRequests').set({
                coverageOverrideApplied: true, coverageOverrideReason: reason || '',
            }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'COVERAGE_OVERRIDE', entityType: 'LeaveRequest', entityId: id, newValue: reason, reason: 'Coverage threshold override applied' });
            return cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
        });

        /* CREATE: enforce instance + auto-fill denormalised fields + balance check */
        srv.before('CREATE', 'LeaveRequests', async (req) => {
            const data = req.data;
            const emp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: data.employeeNo }));
            if (!emp) req.reject(400, `Employee ${data.employeeNo} not found.`);
            await auth.assertCanAccessEmployee(srv, req, data.employeeNo);
            data.employee_ID = emp.employeeNo;
            data.department_code = emp.department_code;
            const calc = await leaveCalc.calculateLeaveDays(srv, {
                employeeNo: data.employeeNo, leaveTypeCode: data.leaveType_code,
                startDate: data.startDate, endDate: data.endDate,
            });
            data.days = calc.workingDays;
            data.medicalCertRequired = calc.medicalCertRequired;
            data.status = data.status || 'DRAFT';
        });

        /* ============================================================
         * Overtime Requests — bound actions
         * ========================================================== */
        srv.on('recalc', 'OvertimeRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const ot = await cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
            if (!ot) req.reject(404, 'Overtime request not found.');
            const r = await overtime.calculateOvertime(srv, {
                employeeNo: ot.employeeNo, workDate: ot.workDate,
                otStart: ot.otStart, otEnd: ot.otEnd,
                regularShiftHours: ot.regularShiftHours, convertToCompOff: ot.convertToCompOff, excludeId: id,
            });
            await srv.run(UPDATE('OvertimeRequests').set({
                otMinutes: r.otMinutes, otHours: r.otHours, otType: r.otType,
                multiplier: r.multiplier, baseHourlyRate: r.baseHourlyRate,
                estimatedAmount: r.estimatedAmount, compOffCredits: r.compOffCredits,
                complianceMessages: r.complianceMessages,
            }).where({ ID: id }));
            return cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
        });

        srv.on('submit', 'OvertimeRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const ot = await cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
            if (!ot) req.reject(404, 'Overtime request not found.');
            await auth.assertCanAccessEmployee(srv, req, ot.employeeNo);
            const r = await overtime.calculateOvertime(srv, {
                employeeNo: ot.employeeNo, workDate: ot.workDate,
                otStart: ot.otStart, otEnd: ot.otEnd,
                regularShiftHours: ot.regularShiftHours, convertToCompOff: ot.convertToCompOff, excludeId: id,
            });
            if (r.isBlocked) req.reject(400, `Overtime cannot be submitted: ${r.complianceMessages}`);
            await srv.run(UPDATE('OvertimeRequests').set({
                status: 'PENDING_MANAGER', otMinutes: r.otMinutes, otHours: r.otHours, otType: r.otType,
                multiplier: r.multiplier, baseHourlyRate: r.baseHourlyRate,
                estimatedAmount: r.estimatedAmount, compOffCredits: r.compOffCredits,
                complianceMessages: r.complianceMessages,
            }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'OVERTIME_SUBMITTED', entityType: 'OvertimeRequest', entityId: id, prevValue: 'DRAFT', newValue: 'PENDING_MANAGER', reason: `${ot.workDate} ${ot.otStart}-${ot.otEnd} (${r.otHours}h)` });
            await addApprovalHistory(srv, 'OVERTIME', id, req, 'SUBMITTED', 'DRAFT', 'PENDING_MANAGER', 'Submitted by employee');
            return cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
        });

        srv.on('approve', 'OvertimeRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const comment = req.data.comment;
            const ot = await cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
            if (!ot) req.reject(404, 'Overtime request not found.');
            if (!['PENDING_MANAGER', 'SENT_BACK'].includes(ot.status)) req.reject(400, `Cannot approve a request in status ${ot.status}.`);
            // Re-run compliance on approval (balances may have changed)
            const r = await overtime.calculateOvertime(srv, {
                employeeNo: ot.employeeNo, workDate: ot.workDate,
                otStart: ot.otStart, otEnd: ot.otEnd,
                regularShiftHours: ot.regularShiftHours, convertToCompOff: ot.convertToCompOff, excludeId: id,
            });
            if (r.isBlocked) req.reject(400, `Cannot approve: ${r.complianceMessages}`);
            await srv.run(UPDATE('OvertimeRequests').set({
                status: 'APPROVED', approver_ID: auth.currentEmployeeNo(req), managerComment: comment || '',
                complianceMessages: r.complianceMessages,
            }).where({ ID: id }));
            ot.otMinutes = r.otMinutes; ot.otHours = r.otHours;
            await overtime.recordWorkHours(srv, ot);     // daily/weekly/quarterly aggregates
            await overtime.grantCompOff(srv, ot);         // comp-off credits if opted in
            await writeAudit(srv, { userId: auth.userId(req), action: 'OVERTIME_APPROVED', entityType: 'OvertimeRequest', entityId: id, prevValue: ot.status, newValue: 'APPROVED', reason: comment || 'Approved by manager' });
            await addApprovalHistory(srv, 'OVERTIME', id, req, 'APPROVED', ot.status, 'APPROVED', comment);
            return cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
        });

        srv.on('rejectRequest', 'OvertimeRequests', async (req) => rejectOvertime(srv, req, 'REJECTED', req.data.comment));
        srv.on('sendBack', 'OvertimeRequests', async (req) => rejectOvertime(srv, req, 'SENT_BACK', req.data.comment));
        srv.on('cancel', 'OvertimeRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const ot = await cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
            if (!ot) req.reject(404, 'Overtime request not found.');
            await auth.assertCanAccessEmployee(srv, req, ot.employeeNo);
            if (ot.status === 'APPROVED') req.reject(400, 'Cannot cancel an already-approved request.');
            await srv.run(UPDATE('OvertimeRequests').set({ status: 'CANCELLED' }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'OVERTIME_CANCELLED', entityType: 'OvertimeRequest', entityId: id, prevValue: ot.status, newValue: 'CANCELLED', reason: 'Cancelled by owner' });
            await addApprovalHistory(srv, 'OVERTIME', id, req, 'CANCELLED', ot.status, 'CANCELLED', 'Cancelled by owner');
            return cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
        });

        srv.before('CREATE', 'OvertimeRequests', async (req) => {
            const data = req.data;
            const emp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: data.employeeNo }));
            if (!emp) req.reject(400, `Employee ${data.employeeNo} not found.`);
            await auth.assertCanAccessEmployee(srv, req, data.employeeNo);
            data.employee_ID = emp.employeeNo;
            data.department_code = emp.department_code;
            data.status = data.status || 'DRAFT';
            const r = await overtime.calculateOvertime(srv, {
                employeeNo: data.employeeNo, workDate: data.workDate,
                otStart: data.otStart, otEnd: data.otEnd,
                regularShiftHours: data.regularShiftHours || 0, convertToCompOff: data.convertToCompOff,
            });
            data.otMinutes = r.otMinutes; data.otHours = r.otHours; data.otType = r.otType;
            data.multiplier = r.multiplier; data.baseHourlyRate = r.baseHourlyRate;
            data.estimatedAmount = r.estimatedAmount; data.compOffCredits = r.compOffCredits;
            data.complianceMessages = r.complianceMessages;
        });

        /* ============================================================
         * Shift Assignments — rest period enforcement on CREATE/UPDATE
         * ========================================================== */
        srv.before('CREATE', 'ShiftAssignments', async (req) => {
            const data = req.data;
            const emp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: data.employeeNo }));
            if (!emp) req.reject(400, `Employee ${data.employeeNo} not found.`);
            data.employee_ID = emp.employeeNo; data.department_code = emp.department_code;
            const tpl = await cds.db.run(SELECT.one.from('ShiftTemplates').where({ code: data.template_code }));
            if (tpl) {
                data.startTime = data.startTime || tpl.startTime;
                data.endTime = data.endTime || tpl.endTime;
                data.crossesMidnight = data.crossesMidnight ?? tpl.crossesMidnight;
            }
            const r = await rest.validateRestPeriod(srv, {
                employeeNo: data.employeeNo, shiftDate: data.shiftDate,
                startTime: data.startTime, endTime: data.endTime, crossesMidnight: data.crossesMidnight,
            });
            if (!r.ok) req.reject(400, `Invalid shift assignment: ${r.messages}`);
        });
        srv.before('UPDATE', 'ShiftAssignments', async (req) => {
            const data = req.data;
            const id = req.data.ID;
            const existing = await cds.db.run(SELECT.one.from('my.hr.ShiftAssignments').where({ ID: id }));
            if (!existing) return;
            const merged = { ...existing, ...data };
            const r = await rest.validateRestPeriod(srv, {
                employeeNo: merged.employeeNo, shiftDate: merged.shiftDate,
                startTime: merged.startTime, endTime: merged.endTime,
                crossesMidnight: merged.crossesMidnight, excludeAssignmentId: id,
            });
            if (!r.ok) req.reject(400, `Invalid shift update: ${r.messages}`);
        });

        /* ============================================================
         * Shift Swap — full workflow
         * ========================================================== */
        srv.on('submit', 'ShiftSwapRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const sw = await cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
            if (!sw) req.reject(404, 'Swap request not found.');
            await auth.assertCanAccessEmployee(srv, req, sw.requestor_ID);
            const check = await swapEligibility(srv, sw);
            if (!check.ok) req.reject(400, `Swap not eligible: ${check.messages}`);
            await srv.run(UPDATE('ShiftSwapRequests').set({
                status: 'PENDING_PEER', eligibilityCheckPassed: true, eligibilityMessages: check.messages,
            }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'SWAP_SUBMITTED', entityType: 'ShiftSwapRequest', entityId: id, prevValue: sw.status, newValue: 'PENDING_PEER', reason: check.messages });
            return cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
        });

        srv.on('peerAccept', 'ShiftSwapRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const sw = await cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
            if (!sw) req.reject(404, 'Swap request not found.');
            if (sw.status !== 'PENDING_PEER') req.reject(400, `Cannot accept a swap in status ${sw.status}.`);
            const me = auth.currentEmployeeNo(req);
            if (sw.targetEmployee_ID !== me) req.reject(403, 'Only the target employee can accept this swap.');
            await srv.run(UPDATE('ShiftSwapRequests').set({
                status: 'PENDING_MANAGER', peerAcceptedAt: new Date(), peerComment: req.data.comment || '',
            }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'SWAP_PEER_ACCEPTED', entityType: 'ShiftSwapRequest', entityId: id, prevValue: 'PENDING_PEER', newValue: 'PENDING_MANAGER', reason: req.data.comment || 'Peer accepted' });
            await addApprovalHistory(srv, 'SWAP', id, req, 'SUBMITTED', 'PENDING_PEER', 'PENDING_MANAGER', 'Peer accepted swap');
            return cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
        });

        srv.on('peerReject', 'ShiftSwapRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const sw = await cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
            if (!sw) req.reject(404, 'Swap request not found.');
            if (sw.status !== 'PENDING_PEER') req.reject(400, `Cannot reject a swap in status ${sw.status}.`);
            await srv.run(UPDATE('ShiftSwapRequests').set({ status: 'REJECTED', peerComment: req.data.comment || '' }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'SWAP_PEER_REJECTED', entityType: 'ShiftSwapRequest', entityId: id, prevValue: 'PENDING_PEER', newValue: 'REJECTED', reason: req.data.comment || 'Peer rejected' });
            return cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
        });

        srv.on('approve', 'ShiftSwapRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const sw = await cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
            if (!sw) req.reject(404, 'Swap request not found.');
            if (sw.status !== 'PENDING_MANAGER') req.reject(400, `Cannot approve a swap in status ${sw.status}.`);
            // Re-validate rest period for the target taking over the shift
            const assignment = await cds.db.run(SELECT.one.from('my.hr.ShiftAssignments').where({ ID: sw.assignment_ID }));
            if (!assignment) req.reject(400, 'Underlying shift assignment no longer exists.');
            const restCheck = await rest.validateRestPeriod(srv, {
                employeeNo: sw.targetEmployee_ID, shiftDate: assignment.shiftDate,
                startTime: assignment.startTime, endTime: assignment.endTime,
                crossesMidnight: assignment.crossesMidnight, excludeAssignmentId: assignment.ID,
            });
            if (!restCheck.ok) req.reject(400, `Cannot approve: target employee rest violation: ${restCheck.messages}`);

            // Reassign the shift to the target employee
            await srv.run(UPDATE('ShiftAssignments').set({
                employee_ID: sw.targetEmployee_ID,
                employeeNo: sw.targetEmployee_ID, status: 'SWAPPED', originSwap_ID: id,
            }).where({ ID: assignment.ID }));
            await srv.run(UPDATE('ShiftSwapRequests').set({
                status: 'APPROVED', approver_ID: auth.currentEmployeeNo(req), managerComment: req.data.comment || '',
            }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'SWAP_APPROVED', entityType: 'ShiftSwapRequest', entityId: id, prevValue: 'PENDING_MANAGER', newValue: 'APPROVED', reason: req.data.comment || 'Approved by manager' });
            await addApprovalHistory(srv, 'SWAP', id, req, 'APPROVED', 'PENDING_MANAGER', 'APPROVED', req.data.comment);
            return cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
        });

        srv.on('rejectRequest', 'ShiftSwapRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const sw = await cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
            if (!sw) req.reject(404, 'Swap request not found.');
            if (!['PENDING_MANAGER', 'PENDING_PEER'].includes(sw.status)) req.reject(400, `Cannot reject a swap in status ${sw.status}.`);
            await srv.run(UPDATE('ShiftSwapRequests').set({ status: 'REJECTED', approver_ID: auth.currentEmployeeNo(req), managerComment: req.data.comment || '' }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'SWAP_REJECTED', entityType: 'ShiftSwapRequest', entityId: id, prevValue: sw.status, newValue: 'REJECTED', reason: req.data.comment || 'Rejected' });
            await addApprovalHistory(srv, 'SWAP', id, req, 'REJECTED', sw.status, 'REJECTED', req.data.comment);
            return cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
        });
        srv.on('cancel', 'ShiftSwapRequests', async (req) => {
            const id = req.params[0]?.ID || req.params[0];
            const sw = await cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
            if (!sw) req.reject(404, 'Swap request not found.');
            await srv.run(UPDATE('ShiftSwapRequests').set({ status: 'CANCELLED' }).where({ ID: id }));
            await writeAudit(srv, { userId: auth.userId(req), action: 'SWAP_CANCELLED', entityType: 'ShiftSwapRequest', entityId: id, prevValue: sw.status, newValue: 'CANCELLED', reason: 'Cancelled by requestor' });
            return cds.db.run(SELECT.one.from('my.hr.ShiftSwapRequests').where({ ID: id }));
        });

        srv.before('CREATE', 'ShiftSwapRequests', async (req) => {
            const data = req.data;
            const reqEmp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: data.requestor_ID }));
            const tgtEmp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: data.targetEmployee_ID }));
            if (!reqEmp || !tgtEmp) req.reject(400, 'Requestor or target employee not found.');
            await auth.assertCanAccessEmployee(srv, req, data.requestor_ID);
            data.requestor_ID = data.requestor_ID; // stored as employeeNo
            data.assignment_ID = data.assignment_ID;
            data.status = 'SUBMITTED';
        });

        /* ============================================================
         * HR config changes — audit every policy change
         * ========================================================== */
        for (const cfg of ['LeaveTypes', 'LeavePolicies', 'ShiftTemplates', 'ComplianceRules', 'OvertimePolicies', 'CompanyHolidays', 'BlackoutPeriods', 'Departments']) {
            srv.after('UPDATE', cfg, async (data, req) => {
                await writeAudit(srv, { userId: auth.userId(req), action: `CONFIG_UPDATE_${cfg.toUpperCase()}`, entityType: cfg, entityId: data.ID, newValue: JSON.stringify(data), reason: 'Configuration change' });
            });
            srv.after('CREATE', cfg, async (data, req) => {
                await writeAudit(srv, { userId: auth.userId(req), action: `CONFIG_CREATE_${cfg.toUpperCase()}`, entityType: cfg, entityId: data.ID, newValue: JSON.stringify(data), reason: 'Configuration created' });
            });
        }

        /* Leave balance adjustment audit (HR only) */
        srv.after('UPDATE', 'LeaveBalances', async (data, req) => {
            await writeAudit(srv, { userId: auth.userId(req), action: 'LEAVE_BALANCE_ADJUSTED', entityType: 'LeaveBalance', entityId: data.ID, newValue: JSON.stringify(data), reason: 'Leave balance adjustment' });
        });

        /* ============================================================
         * Dashboard functions (computed server-side, no hardcoding)
         * ========================================================== */
        srv.on('getEmployeeDashboard', async (req) => {
            const { employeeNo } = req.data;
            const emp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo }));
            if (!emp) req.reject(404, 'Employee not found.');
            await auth.assertCanAccessEmployee(srv, req, employeeNo);

            const balances = await cds.db.run(SELECT.from('my.hr.LeaveBalances').where({ employee_ID: employeeNo }));
            const bal = (code) => balances.find(b => b.leaveType_code === code);
            const el = bal('EL'), sl = bal('SL'), cl = bal('CL'), comp = bal('COMP');

            const pendingLeave = await cds.db.run(SELECT.from('my.hr.LeaveRequests').where({ employee_ID: employeeNo }).and("status in ('SUBMITTED','PENDING_MANAGER','SENT_BACK')"));
            const approvedLeave = await cds.db.run(SELECT.from('my.hr.LeaveRequests').where({ employee_ID: employeeNo, status: 'APPROVED' }));

            // Weekly working hours from EmployeeWorkHours for the current ISO week
            const du = require('./lib/dateUtils');
            const wk = du.isoWeekKey(new Date());
            const weekRows = await cds.db.run(SELECT.from('my.hr.EmployeeWorkHours').where({ employee_ID: employeeNo, weekKey: wk }));
            const weeklyWorkingHours = Math.round(weekRows.reduce((s, r) => s + (r.regularMinutes || 0) + (r.otMinutes || 0), 0) / 60 * 100) / 100;
            const rules = await overtime.loadComplianceRules(srv, emp.jurisdiction || 'IN-DEFAULT');
            const remainingWeeklyHours = Math.max(0, Math.round((rules.weeklyMaxHours - weeklyWorkingHours) * 100) / 100);

            const pendingOt = await cds.db.run(SELECT.from('my.hr.OvertimeRequests').where({ employee_ID: employeeNo }).and("status in ('SUBMITTED','PENDING_MANAGER','SENT_BACK')"));
            const approvedOt = await cds.db.run(SELECT.from('my.hr.OvertimeRequests').where({ employee_ID: employeeNo, status: 'APPROVED' }));
            const approvedOvertimeHours = Math.round(approvedOt.reduce((s, o) => s + Number(o.otHours || 0), 0) * 100) / 100;

            // Compliance alerts: quarterly OT approaching limit
            const qk = du.quarterKey(new Date());
            const qRows = await cds.db.run(SELECT.from('my.hr.EmployeeWorkHours').where({ employee_ID: employeeNo, quarterKey: qk }));
            const quarterOt = Math.round(qRows.reduce((s, r) => s + (r.otMinutes || 0), 0) / 60 * 100) / 100;
            let complianceAlerts = 0;
            if (quarterOt >= (rules.quarterlyWarnAt || 40)) complianceAlerts += 1;

            return {
                availableEL: el?.available ?? 0,
                availableSL: sl?.available ?? 0,
                availableCL: cl?.available ?? 0,
                availableComp: comp?.available ?? 0,
                pendingLeave: pendingLeave.length,
                approvedLeave: approvedLeave.length,
                weeklyWorkingHours,
                remainingWeeklyHours,
                pendingOvertime: pendingOt.length,
                approvedOvertimeHours,
                complianceAlerts,
            };
        });

        srv.on('getManagerDashboard', async (req) => {
            const { managerNo } = req.data;
            const role = auth.roleCategory(req);
            if (role !== 'MANAGER' && role !== 'HR_ADMIN') req.reject(403, 'Only managers or HR can view the team dashboard.');
            if (role === 'MANAGER' && managerNo !== auth.currentEmployeeNo(req)) req.reject(403, 'You can only view your own team dashboard.');

            const team = await auth.teamMemberIds(srv, managerNo);
            const teamIds = team.map(t => t.employeeNo);
            const today = require('./lib/dateUtils').toDateString(new Date());

            const onLeaveToday = await cds.db.run(
                SELECT.from('my.hr.LeaveRequests')
                    .where("status = 'APPROVED' and employee_ID in", teamIds.length ? teamIds : ['__none__'])
                    .and('startDate <=', today).and('endDate >=', today)
            );
            const onLeaveIds = new Set(onLeaveToday.map(r => r.employee_ID));

            const pendingLeaveApprovals = await cds.db.run(
                SELECT.from('my.hr.LeaveRequests').where("status = 'PENDING_MANAGER' and employee_ID in", teamIds.length ? teamIds : ['__none__'])
            );
            const pendingOvertimeApprovals = await cds.db.run(
                SELECT.from('my.hr.OvertimeRequests').where("status = 'PENDING_MANAGER' and employee_ID in", teamIds.length ? teamIds : ['__none__'])
            );
            const pendingSwapRequests = await cds.db.run(
                SELECT.from('my.hr.ShiftSwapRequests').where("status = 'PENDING_MANAGER' and requestor_ID in", teamIds.length ? teamIds : ['__none__'])
            );

            const totalTeam = team.length;
            const present = totalTeam - onLeaveIds.size;
            const staffingPercent = totalTeam ? Math.round(present / totalTeam * 1000) / 10 : 0;

            // Compliance alerts across the team (quarterly OT approaching limit)
            const du = require('./lib/dateUtils');
            const qk = du.quarterKey(new Date());
            const qRows = await cds.db.run(SELECT.from('my.hr.EmployeeWorkHours').where({ quarterKey: qk }).and("employee_ID in", teamIds.length ? teamIds : ['__none__']));
            const firstEmp = team[0] ? await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: team[0].employeeNo })) : null;
            const rules = await overtime.loadComplianceRules(srv, firstEmp?.jurisdiction || 'IN-DEFAULT');
            const otByEmp = new Map();
            for (const r of qRows) otByEmp.set(r.employee_ID, (otByEmp.get(r.employee_ID) || 0) + (r.otMinutes || 0));
            let complianceAlerts = 0;
            for (const v of otByEmp.values()) {
                if (v / 60 >= (rules.quarterlyWarnAt || 40)) complianceAlerts += 1;
            }

            return {
                totalTeam, present, onLeave: onLeaveIds.size,
                pendingLeaveApprovals: pendingLeaveApprovals.length,
                pendingOvertimeApprovals: pendingOvertimeApprovals.length,
                pendingSwapRequests: pendingSwapRequests.length,
                staffingPercent, complianceAlerts,
            };
        });

        srv.on('calculateLeaveDays', async (req) => {
            const { employeeNo, leaveTypeCode, startDate, endDate } = req.data;
            const r = await leaveCalc.calculateLeaveDays(srv, { employeeNo, leaveTypeCode, startDate, endDate });
            return { workingDays: r.workingDays, isBlocked: r.isBlocked, medicalCertRequired: r.medicalCertRequired, messages: r.messages };
        });

        /** Eligible swap candidates: same department, not on leave, no conflicting shift, skill overlap. */
        srv.on('getSwapCandidates', async (req) => {
            const { employeeNo, assignment_ID } = req.data;
            const emp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo }));
            if (!emp) req.reject(404, 'Employee not found.');
            const assignment = await cds.db.run(SELECT.one.from('my.hr.ShiftAssignments').where({ ID: assignment_ID }));
            if (!assignment) req.reject(400, 'Shift assignment not found.');
            const du2 = require('./lib/dateUtils');
            const ds = du2.toDateString(assignment.shiftDate);
            const mySkills = new Set(
                (await cds.db.run(SELECT.from('my.hr.EmployeeSkills').where({ employee_ID: employeeNo })))
                    .filter(s => s.proficiency !== 'BEGINNER').map(s => s.skill)
            );
            const colleagues = await cds.db.run(
                SELECT.from('my.hr.Employees')
                    .where({ department_code: emp.department_code, status: 'ACTIVE' })
                    .and('employeeNo !=', employeeNo)
            );
            const out = [];
            for (const c of colleagues) {
                const onLeave = await cds.db.run(
                    SELECT.one.from('my.hr.LeaveRequests').where({ employee_ID: c.employeeNo, status: 'APPROVED' })
                        .and('startDate <=', ds).and('endDate >=', ds)
                );
                if (onLeave) continue;
                const hasShift = await cds.db.run(
                    SELECT.one.from('my.hr.ShiftAssignments').where({ employee_ID: c.employeeNo, status: 'ASSIGNED', shiftDate: ds })
                );
                if (hasShift) continue;
                const cSkills = await cds.db.run(SELECT.from('my.hr.EmployeeSkills').where({ employee_ID: c.employeeNo }));
                const skillMatch = cSkills.some(s => mySkills.has(s.skill));
                out.push({
                    employeeNo: c.employeeNo,
                    fullName: c.fullName || (c.firstName + ' ' + c.lastName),
                    department_code: c.department_code,
                    skillMatch,
                    messages: skillMatch ? 'Skills match' : 'No overlapping skill'
                });
            }
            return out;
        });

        return super.init();
    }
};

/* ---------------- helper functions ---------------- */

async function rejectLeave(srv, req, newStatus, comment) {
    const id = req.params[0]?.ID || req.params[0];
    const lr = await cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
    if (!lr) req.reject(404, 'Leave request not found.');
    if (!['PENDING_MANAGER', 'SENT_BACK'].includes(lr.status)) req.reject(400, `Cannot ${newStatus.toLowerCase()} a request in status ${lr.status}.`);
    await srv.run(UPDATE('LeaveRequests').set({ status: newStatus, approver_ID: auth.currentEmployeeNo(req), managerComment: comment || '' }).where({ ID: id }));
    await leaveCalc.releasePending(srv, lr);
    await writeAudit(srv, { userId: auth.userId(req), action: `LEAVE_${newStatus}`, entityType: 'LeaveRequest', entityId: id, prevValue: lr.status, newValue: newStatus, reason: comment || '' });
    await addApprovalHistory(srv, 'LEAVE', id, req, newStatus, lr.status, newStatus, comment);
    return cds.db.run(SELECT.one.from('my.hr.LeaveRequests').where({ ID: id }));
}

async function rejectOvertime(srv, req, newStatus, comment) {
    const id = req.params[0]?.ID || req.params[0];
    const ot = await cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
    if (!ot) req.reject(404, 'Overtime request not found.');
    if (!['PENDING_MANAGER', 'SENT_BACK'].includes(ot.status)) req.reject(400, `Cannot ${newStatus.toLowerCase()} a request in status ${ot.status}.`);
    await srv.run(UPDATE('OvertimeRequests').set({ status: newStatus, approver_ID: auth.currentEmployeeNo(req), managerComment: comment || '' }).where({ ID: id }));
    await writeAudit(srv, { userId: auth.userId(req), action: `OVERTIME_${newStatus}`, entityType: 'OvertimeRequest', entityId: id, prevValue: ot.status, newValue: newStatus, reason: comment || '' });
    await addApprovalHistory(srv, 'OVERTIME', id, req, newStatus, ot.status, newStatus, comment);
    return cds.db.run(SELECT.one.from('my.hr.OvertimeRequests').where({ ID: id }));
}

async function addApprovalHistory(srv, requestType, requestId, req, action, fromStatus, toStatus, comments) {
    await srv.run(INSERT.into('ApprovalHistory').entries({
        requestType, request_ID: requestId,
        approver_ID: auth.currentEmployeeNo(req) || auth.userId(req),
        approverName: auth.currentEmployeeNo(req) || 'system',
        action, fromStatus, toStatus, comments: comments || '',
        timestamp: new Date(),
    }));
}

/** Swap eligibility: same skills overlap + target has no shift conflict + not on leave. */
async function swapEligibility(srv, sw) {
    const messages = [];
    const reqEmp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: sw.requestor_ID }));
    const tgtEmp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: sw.targetEmployee_ID }));
    if (!tgtEmp) return { ok: false, messages: 'Target employee not found.' };
    if (sw.requestor_ID === sw.targetEmployee_ID) return { ok: false, messages: 'Cannot swap with yourself.' };

    const assignment = await cds.db.run(SELECT.one.from('my.hr.ShiftAssignments').where({ ID: sw.assignment_ID }));
    if (!assignment) return { ok: false, messages: 'Underlying shift assignment not found.' };
    if (assignment.employeeNo !== sw.requestor_ID) return { ok: false, messages: 'Shift does not belong to the requestor.' };

    // Skills overlap (at least one shared skill at >= INTERMEDIATE)
    const reqSkills = await cds.db.run(SELECT.from('my.hr.EmployeeSkills').where({ employee_ID: reqEmp.employeeNo }));
    const tgtSkills = await cds.db.run(SELECT.from('my.hr.EmployeeSkills').where({ employee_ID: tgtEmp.employeeNo }));
    const reqSet = new Set(reqSkills.filter(s => s.proficiency !== 'BEGINNER').map(s => s.skill));
    const shared = tgtSkills.filter(s => reqSet.has(s.skill));
    if (shared.length === 0) {
        messages.push('No matching skills at sufficient proficiency.');
    }

    // Target must not be on approved leave that day
    const ds = require('./lib/dateUtils').toDateString(assignment.shiftDate);
    const leaveConflict = await cds.db.run(
        SELECT.one.from('my.hr.LeaveRequests').where({ employee_ID: tgtEmp.employeeNo, status: 'APPROVED' }).and('startDate <=', ds).and('endDate >=', ds)
    );
    if (leaveConflict) messages.push(`Target is on approved leave on ${ds}.`);

    // Target must not already have a conflicting shift
    const shiftConflict = await cds.db.run(
        SELECT.one.from('my.hr.ShiftAssignments').where({ employee_ID: tgtEmp.employeeNo, status: 'ASSIGNED', shiftDate: ds })
    );
    if (shiftConflict) messages.push(`Target already has a shift on ${ds} (${shiftConflict.template_code}).`);

    // Rest period check for target taking the shift
    const restCheck = await rest.validateRestPeriod(srv, {
        employeeNo: sw.targetEmployee_ID, shiftDate: assignment.shiftDate,
        startTime: assignment.startTime, endTime: assignment.endTime,
        crossesMidnight: assignment.crossesMidnight, excludeAssignmentId: assignment.ID,
    });
    if (!restCheck.ok) messages.push(`Rest period issue for target: ${restCheck.messages}`);

    const ok = messages.length === 0;
    return { ok, messages: ok ? 'Swap is eligible.' : messages.join(' | ') };
}
