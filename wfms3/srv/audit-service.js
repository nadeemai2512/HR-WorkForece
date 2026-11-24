/**
 * wfms/srv/audit-service.js
 *
 * After-READ handlers that populate the virtual fields of the dashboard
 * projections (EmployeeKPIs, ManagerKPIs, ComplianceAlerts). Every KPI tile
 * in the UI binds to a field produced here; nothing is hardcoded in the UI.
 *
 * Also enforces instance-based authorization: an Employee can only read their
 * own LeaveRequests / OvertimeRequests rows; a Manager can only read rows of
 * employees in their reporting scope.
 *
 * NOTE on CAP after-READ arity: a handler with signature (result, req) is
 * called ONCE with the full result (array for lists, object for single-key
 * reads). We loop over the rows ourselves so virtual fields are populated
 * for every row, list or object-page.
 */
const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const calc = require('./lib/calculations');
const { userId } = require('./lib/audit');

module.exports = (srv) => {

        async function currentEmployee(req) {
            const tx = cds.tx(req);
            const id = userId(req);
            return tx.run(SELECT.one.from('wfms.Employees').where `email = ${id}`);
        }

        /** Run an async fn for every row in result (array or single). */
        function forEachRow(handler) {
            return async (result, req) => {
                const rows = Array.isArray(result) ? result : (result ? [result] : []);
                for (const each of rows) {
                    try { await handler(each, req); }
                    catch (e) { console.error('[dashboard handler]', e.message, e.stack); }
                }
            };
        }

        /* ---------------- EmployeeKPIs ---------------- */
        srv.after('READ', 'EmployeeKPIs', forEachRow(async (each, req) => {
            const tx = cds.tx(req);
            const empId = each.ID;
            const year = new Date().getFullYear();

            const bals = await tx.run(
                SELECT.from('wfms.LeaveBalances')
                    .columns `available, leaveType.code as code`
                    .where `employee_ID = ${empId} and year = ${year}`
            );
            each.availableEL = bals.find(b => b.code === 'EL')?.available ?? 0;
            each.availableSL = bals.find(b => b.code === 'SL')?.available ?? 0;
            each.availableCL = bals.find(b => b.code === 'CL')?.available ?? 0;
            each.availableCO = bals.find(b => b.code === 'CO')?.available ?? 0;

            const lReq = await tx.run(
                SELECT.from('wfms.LeaveRequests').columns `status`
                    .where `employee_ID = ${empId}`
            );
            each.pendingLeave = lReq.filter(r => r.status === 'PendingManager').length;
            each.approvedLeave = lReq.filter(r => r.status === 'Approved').length;

            const oReq = await tx.run(
                SELECT.from('wfms.OvertimeRequests').columns `status, overtimeMinutes`
                    .where `employee_ID = ${empId}`
            );
            each.pendingOvertime = oReq.filter(r => r.status === 'PendingManager').length;
            each.approvedOvertimeMinutes = oReq.filter(r => r.status === 'Approved').reduce((s, r) => s + (r.overtimeMinutes || 0), 0);

            const monday = calc.startOfWeek(new Date());
            const sunday = calc.addDays(monday, 6);
            const wh = await tx.run(
                SELECT.from('wfms.EmployeeWorkHours')
                    .where `employee_ID = ${empId} and workDate >= ${calc.isoDate(monday)} and workDate <= ${calc.isoDate(sunday)}`
            );
            each.weeklyMinutes = wh.reduce((s, r) => s + (r.totalMinutes || 0), 0);
            const _ctx = await tx.run(SELECT.one.from('wfms.Employees')
                .columns `country, region, employeeCategory`.where `ID = ${empId}`);
            const rule = await calc.activeComplianceRule(tx, _ctx || each);
            each.remainingWeeklyMinutes = Math.max(0, Math.round(Number(rule.weeklyMaxTotalHours) * 60) - each.weeklyMinutes);
        }));

        /* ---------------- ManagerKPIs ---------------- */
        srv.after('READ', 'ManagerKPIs', forEachRow(async (each, req) => {
            const tx = cds.tx(req);
            const mgrId = each.ID;
            const directReports = await tx.run(
                SELECT.from('wfms.Employees').where `manager_ID = ${mgrId} and status = 'Active'`
            );
            const reportIds = directReports.map(r => r.ID);
            each.teamMembers = directReports.length;
            if (reportIds.length === 0) {
                each.presentToday = 0; each.onLeaveToday = 0;
                each.pendingLeaveApprovals = 0; each.pendingOvertimeApprovals = 0;
                each.pendingSwapRequests = 0; each.staffingPct = 100; each.complianceAlerts = 0;
                return;
            }
            const todayIso = calc.isoDate(new Date());
            const onLeaveTodayRows = await tx.run(
                SELECT.from('wfms.LeaveRequests')
                    .where `status = 'Approved' and startDate <= ${todayIso} and endDate >= ${todayIso} and employee_ID in ${reportIds}`
            );
            each.onLeaveToday = new Set(onLeaveTodayRows.map(r => r.employee_ID)).size;
            each.presentToday = directReports.length - each.onLeaveToday;
            each.staffingPct = Math.round(each.presentToday / directReports.length * 10000) / 100;

            each.pendingLeaveApprovals = (await tx.run(
                SELECT.from('wfms.LeaveRequests').where `status = 'PendingManager' and employee_ID in ${reportIds}`
            )).length;
            each.pendingOvertimeApprovals = (await tx.run(
                SELECT.from('wfms.OvertimeRequests').where `status = 'PendingManager' and employee_ID in ${reportIds}`
            )).length;
            each.pendingSwapRequests = (await tx.run(
                SELECT.from('wfms.ShiftSwapRequests').where `status = 'PendingManager' and requestor_ID in ${reportIds}`
            )).length;

            const _ctx = await tx.run(SELECT.one.from('wfms.Employees')
                .columns `country, region, employeeCategory`.where `ID = ${each.ID}`);
            const rule = await calc.activeComplianceRule(tx, _ctx || { country: each.country, region: each.region, employeeCategory: each.employeeCategory });
            const q = calc.quarterBounds(new Date());
            const qOt = await tx.run(
                SELECT.from('wfms.OvertimeRequests').columns `employee_ID, overtimeMinutes`
                    .where `status = 'Approved' and workDate >= ${calc.isoDate(q.start)} and workDate <= ${calc.isoDate(q.end)} and employee_ID in ${reportIds}`
            );
            const perEmp = {};
            for (const o of qOt) perEmp[o.employee_ID] = (perEmp[o.employee_ID] || 0) + (o.overtimeMinutes || 0);
            const warnHours = Number(rule.quarterlyOvertimeLimit) * (Number(rule.warningThresholdPct) || 80) / 100;
            each.complianceAlerts = Object.values(perEmp).filter(m => m / 60 >= warnHours).length;
        }));

        /* ---------------- ComplianceAlerts ---------------- */
        srv.after('READ', 'ComplianceAlerts', forEachRow(async (each, req) => {
            const tx = cds.tx(req);
            const _ctx = await tx.run(SELECT.one.from('wfms.Employees')
                .columns `country, region, employeeCategory`.where `ID = ${each.ID}`);
            const rule = await calc.activeComplianceRule(tx, _ctx || { country: each.country, region: each.region, employeeCategory: each.employeeCategory });
            const q = calc.quarterBounds(new Date());
            const qOt = await tx.run(
                SELECT.from('wfms.OvertimeRequests').columns `overtimeMinutes`
                    .where `status = 'Approved' and workDate >= ${calc.isoDate(q.start)} and workDate <= ${calc.isoDate(q.end)} and employee_ID = ${each.ID}`
            );
            const qMinutes = qOt.reduce((s, r) => s + (r.overtimeMinutes || 0), 0);
            const qHours = qMinutes / 60;
            const limit = Number(rule.quarterlyOvertimeLimit);
            const warnPct = Number(rule.warningThresholdPct) || 80;
            if (qHours >= limit) {
                each.alertType = 'QuarterlyOvertimeExceeded';
                each.severity = 'Critical';
                each.message = `Quarterly overtime ${qHours.toFixed(1)}h exceeds statutory limit ${limit}h.`;
            } else if (qHours >= limit * warnPct / 100) {
                each.alertType = 'QuarterlyOvertimeWarning';
                each.severity = 'Warning';
                each.message = `Quarterly overtime ${qHours.toFixed(1)}h approaching limit ${limit}h (${Math.round(qHours / limit * 100)}%).`;
            } else {
                each.alertType = 'None';
                each.severity = 'Info';
                each.message = 'Within compliance.';
            }
            each.asOfDate = calc.isoDate(new Date());
        }));

        /* ---------------- instance-based authorization ----------------
         * Employees see only their own rows; Managers see their own +
         * direct reports' rows; HRAdmin sees everything. The scope is
         * ALWAYS applied (AND-ed onto any existing $filter) so an employee
         * cannot bypass row scoping by crafting a status filter - the
         * previous `if (!target)` guard only scoped unfiltered reads.
         */
        async function resolveScope(req) {
            const emp = await currentEmployee(req);
            if (!emp) return null;
            let reportIds = [];
            if (req.user.roles.Manager) {
                const tx = cds.tx(req);
                const reports = await tx.run(
                    SELECT.from('wfms.Employees').columns `ID`
                        .where `manager_ID = ${emp.ID} and status = 'Active'`
                );
                reportIds = reports.map(r => r.ID);
            }
            return { emp, reportIds };
        }

        /** Scope a transactional entity (field = employee_ID) to the
         *  authenticated employee (Employee role) or their team (Manager). */
        function scopedRead(sField) {
            return async (req) => {
                if (!req.user || !req.user.roles) return;
                // HRAdmin-only users (no Employee/Manager role) see everything
                if (!req.user.roles.Employee && !req.user.roles.Manager) return;
                const scope = await resolveScope(req);
                if (!scope) return req.error(403, 'No employee record linked to your user.');
                const { emp, reportIds } = scope;
                if (req.user.roles.Manager) {
                    const ids = [emp.ID, ...reportIds];
                    req.query.where`employee_ID in ${ids}`;
                } else {
                    req.query.where({ [sField]: emp.ID });
                }
            };
        }

        /** Restrict a self-projection (EmployeeKPIs / ManagerKPIs) to the
         *  authenticated user's own Employees row (field = ID). HRAdmin-only
         *  users see all rows so they can browse any employee via HR tools. */
        function selfScopedRead() {
            return async (req) => {
                if (!req.user || !req.user.roles) return;
                if (!req.user.roles.Employee && !req.user.roles.Manager) return;
                const emp = await currentEmployee(req);
                if (!emp) return req.error(403, 'No employee record linked to your user.');
                req.query.where({ ID: emp.ID });
            };
        }

        srv.before('READ', 'LeaveRequests',     scopedRead('employee_ID'));
        srv.before('READ', 'OvertimeRequests',  scopedRead('employee_ID'));
        srv.before('READ', 'ShiftAssignments',  scopedRead('employee_ID'));
        /** Scope ShiftSwapRequests to swaps where the authenticated employee is
         *  requestor or target (Employee) or within their team (Manager). HRAdmin
         *  (no Employee/Manager role) sees all swaps. */
        function swapScopedRead() {
            return async (req) => {
                if (!req.user || !req.user.roles) return;
                if (!req.user.roles.Employee && !req.user.roles.Manager) return;
                const scope = await resolveScope(req);
                if (!scope) return req.error(403, 'No employee record linked to your user.');
                const { emp, reportIds } = scope;
                if (req.user.roles.Manager) {
                    const ids = [emp.ID, ...reportIds];
                    req.query.where `requestor_ID in ${ids} or targetEmployee_ID in ${ids}`;
                } else {
                    req.query.where `requestor_ID = ${emp.ID} or targetEmployee_ID = ${emp.ID}`;
                }
            };
        }

        srv.before('READ', 'EmployeeKPIs',      selfScopedRead());
        srv.before('READ', 'ManagerKPIs',       selfScopedRead());
        srv.before('READ', 'ShiftSwapRequests', swapScopedRead());
        srv.before('READ', 'LeaveBalanceView',  scopedRead('employee_ID'));
};
