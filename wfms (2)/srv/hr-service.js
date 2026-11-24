/**
 * wfms/srv/hr-service.js
 *
 * HR administrator actions: leave balance adjustments, payroll-ready
 * overtime export. Adjustments are themselves audited and stored as
 * LeaveBalanceAdjustments rows.
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const { writeAudit, userId } = require('./lib/audit');

module.exports = (srv) => {

        /* ---------------- adjustLeaveBalance ---------------- */
        srv.on('adjustLeaveBalance', async (req) => {
            const tx = cds.tx(req);
            const { ID, delta, reason } = req.data;
            const bal = await tx.run(SELECT.one.from('wfms.LeaveBalances').where({ ID }));
            if (!bal) return req.error(404, 'Leave balance not found');
            if (!reason || !reason.trim()) return req.error(400, 'A documented reason is required for balance adjustments.');

            const prevEnt = Number(bal.entitlement);
            const newEnt = prevEnt + Number(delta);
            const prevAvail = Number(bal.available);
            const newAvail = prevAvail + Number(delta);

            await tx.run(UPDATE('wfms.LeaveBalances').set({
                entitlement: newEnt, available: newAvail
            }).where({ ID }));

            await tx.run(INSERT.into('wfms.LeaveBalanceAdjustments').entries({
                balance_ID: ID, delta: Number(delta), reason,
                adjustedBy: userId(req), previousEntitlement: prevEnt, newEntitlement: newEnt
            }));

            await writeAudit(tx, req, 'LeaveBalanceAdjust', 'LeaveBalance', ID,
                { entitlement: prevEnt, available: prevAvail },
                { entitlement: newEnt, available: newAvail, delta, reason }, reason);
            return {};
        });

        /* ---------------- exportPayrollOvertime ---------------- */
        srv.on('exportPayrollOvertime', async (req) => {
            const tx = cds.tx(req);
            const { fromDate, toDate } = req.data;
            const rows = await tx.run(
                SELECT.from('wfms.OvertimeRequests as O')
                    .columns `E.employeeNumber as employeeNumber, E.fullName as employeeName, D.name as departmentName,
                              O.workDate as workDate, O.overtimeMinutes as overtimeMinutes, O.overtimeType as overtimeType,
                              O.multiplier as multiplier, O.baseHourlyRate as baseHourlyRate, O.estimatedAmount as estimatedAmount,
                              O.status as status, O.compOffElection as compOffElection, O.compOffCreditsEarned as compOffCreditsEarned`
                    .join `wfms.Employees as E on E.ID = O.employee_ID`
                    .join `wfms.Departments as D on D.ID = E.department_ID`
                    .where `O.status = 'Approved' and O.workDate >= ${fromDate} and O.workDate <= ${toDate}`
                    .orderBy `O.workDate asc`
            );
            // CSV with estimated vs approved distinction column (all rows here are approved)
            const header = ['employeeNumber','employeeName','departmentName','workDate','overtimeMinutes','overtimeType','multiplier','baseHourlyRate','estimatedAmount','amountStatus','compOffElection','compOffCreditsEarned'];
            const lines = [header.join(',')];
            for (const r of rows) {
                lines.push(header.map(h => r[h] === null || r[h] === undefined ? '' : `"${String(r[h]).replace(/"/g, '""')}"`).join(','));
            }
            await writeAudit(tx, req, 'PayrollExport', 'OvertimeRequest', 'n/a', { fromDate, toDate, rows: rows.length }, null, 'Payroll overtime export generated');
            return lines.join('\n');
        });
};
