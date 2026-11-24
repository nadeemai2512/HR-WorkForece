'use strict';
/**
 * overtimeCalc.js — overtime duration, multiplier, amount, comp-off and the
 * daily / weekly / quarterly compliance checks. All thresholds are configurable
 * via ComplianceRules and OvertimePolicies (jurisdiction + effective dated).
 * `employee_ID` columns hold the business key `employeeNo`.
 */
const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE } = cds.ql;
const du = require('./dateUtils');

/** Determine overtime category for a given work date. */
function detectOtType(workDate, holidays = []) {
    const d = du.toDate(workDate);
    const ds = du.toDateString(d);
    if (holidays.some(h => du.toDateString(h.holidayDate || h) === ds)) return 'HOLIDAY';
    if (du.isWeekend(d)) return 'WEEKEND';
    return 'WEEKDAY';
}

async function loadOvertimePolicy(srv, otType, jurisdiction) {
    const asOf = du.toDateString(new Date());
    return cds.db.run(
        SELECT.one.from('my.hr.OvertimePolicies')
            .where({ otType, jurisdiction })
            .and('effectiveFrom <=', asOf)
            .and('effectiveTo is null or effectiveTo >=', asOf)
    );
}

async function loadComplianceRules(srv, jurisdiction) {
    const asOf = du.toDateString(new Date());
    const rule = await cds.db.run(
        SELECT.one.from('my.hr.ComplianceRules')
            .where({ jurisdiction })
            .and('effectiveFrom <=', asOf)
            .and('effectiveTo is null or effectiveTo >=', asOf)
    );
    return rule || {
        jurisdiction, dailyMaxHours: 12, weeklyRegularHours: 48,
        weeklyOTAllowance: 12, weeklyMaxHours: 60,
        quarterlyOTLimit: 50, quarterlyWarnAt: 40, minRestHours: 11,
    };
}

async function loadEmployee(srv, employeeNo) {
    return cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo }));
}

/** Other approved/pending overtime for the same employee on the same date. */
async function findOvertimeOverlap(srv, employeeNo, workDate, otStart, otEnd, excludeId = null) {
    const others = await cds.db.run(
        SELECT.from('my.hr.OvertimeRequests')
            .where({ employee_ID: employeeNo, workDate })
            .and("status in ('SUBMITTED','PENDING_MANAGER','APPROVED')")
    );
    const filtered = excludeId ? others.filter(o => o.ID !== excludeId) : others;
    const ns = du.hhmmToMinutes(otStart);
    let ne = du.hhmmToMinutes(otEnd);
    if (ne <= ns) ne += 24 * 60;
    return filtered.find(o => {
        const os = du.hhmmToMinutes(o.otStart);
        let oe = du.hhmmToMinutes(o.otEnd);
        if (oe <= os) oe += 24 * 60;
        return ns < oe && os < ne; // intervals overlap
    }) || null;
}

/** Approved leave overlapping the OT work date. */
async function findLeaveOverlap(srv, employeeNo, workDate) {
    const ds = du.toDateString(workDate);
    return cds.db.run(
        SELECT.one.from('my.hr.LeaveRequests')
            .where({ employee_ID: employeeNo, status: 'APPROVED' })
            .and('startDate <=', ds)
            .and('endDate >=', ds)
    );
}

/** Regular assigned shift overlapping the OT interval on that date. */
async function findShiftOverlap(srv, employeeNo, workDate, otStart, otEnd) {
    const ds = du.toDateString(workDate);
    const shifts = await cds.db.run(
        SELECT.from('my.hr.ShiftAssignments')
            .where({ employee_ID: employeeNo, status: 'ASSIGNED', shiftDate: ds })
    );
    const ns = du.hhmmToMinutes(otStart);
    let ne = du.hhmmToMinutes(otEnd);
    if (ne <= ns) ne += 24 * 60;
    return shifts.find(s => {
        const ss = du.hhmmToMinutes(s.startTime);
        let se = du.hhmmToMinutes(s.endTime);
        if (se <= ss) se += 24 * 60;
        return ns < se && ss < ne;
    }) || null;
}

/** Sum existing OT minutes for a week / quarter from EmployeeWorkHours. */
async function aggregateOvertime(srv, employeeNo, workDate) {
    const wk = du.isoWeekKey(workDate);
    const qk = du.quarterKey(workDate);
    const rows = await cds.db.run(
        SELECT.from('my.hr.EmployeeWorkHours')
            .where({ employee_ID: employeeNo })
            .and('weekKey =', wk, 'or quarterKey =', qk)
    );
    let weekOt = 0, quarterOt = 0, weekReg = 0;
    for (const r of rows) {
        if (r.weekKey === wk) { weekOt += r.otMinutes || 0; weekReg += r.regularMinutes || 0; }
        if (r.quarterKey === qk) quarterOt += r.otMinutes || 0;
    }
    return { weekOtMinutes: weekOt, quarterOtMinutes: quarterOt, weekRegularMinutes: weekReg };
}

/**
 * Full overtime calculation + compliance checks. Returns everything needed to
 * persist an OvertimeRequests row and decide whether to block submission.
 */
async function calculateOvertime(srv, { employeeNo, workDate, otStart, otEnd, regularShiftHours = 0, convertToCompOff = false, excludeId = null }) {
    const messages = [];
    let isBlocked = false;

    const emp = await loadEmployee(srv, employeeNo);
    if (!emp) {
        return { isBlocked: true, messages: 'Employee not found.', otMinutes: 0, otHours: 0, otType: 'WEEKDAY' };
    }

    const holidays = await cds.db.run(SELECT.from('my.hr.CompanyHolidays').where('jurisdiction =', 'ALL', 'or jurisdiction =', emp.jurisdiction || 'ALL'));
    const otType = detectOtType(workDate, holidays);
    const policy = await loadOvertimePolicy(srv, otType, emp.jurisdiction || 'ALL');
    const multiplier = policy?.multiplier ?? (otType === 'HOLIDAY' ? 2.5 : otType === 'WEEKEND' ? 2.0 : 1.5);
    const compOffRate = policy?.compOffConversionRate ?? 1.0;

    const otMinutes = du.minutesBetween(otStart, otEnd);
    const otHours = Math.round((otMinutes / 60) * 100) / 100;
    const baseHourlyRate = emp.baseHourlyRate || 0;
    const estimatedAmount = Math.round(otHours * Number(baseHourlyRate) * Number(multiplier) * 100) / 100;
    const compOffCredits = convertToCompOff ? Math.round(otHours * Number(compOffRate) * 100) / 100 : 0;

    // Overlap checks
    const otOverlap = await findOvertimeOverlap(srv, employeeNo, workDate, otStart, otEnd, excludeId);
    if (otOverlap) { isBlocked = true; messages.push(`Overlaps another overtime entry (${otOverlap.otStart}-${otOverlap.otEnd}, ${otOverlap.status}).`); }
    const leaveOverlap = await findLeaveOverlap(srv, employeeNo, workDate);
    if (leaveOverlap) { isBlocked = true; messages.push(`Overlaps approved leave (${leaveOverlap.startDate} → ${leaveOverlap.endDate}).`); }
    const shiftOverlap = await findShiftOverlap(srv, employeeNo, workDate, otStart, otEnd);
    if (shiftOverlap) { isBlocked = true; messages.push(`Overlaps assigned regular shift (${shiftOverlap.template_code} ${shiftOverlap.startTime}-${shiftOverlap.endTime}).`); }

    // Compliance: daily, weekly, quarterly
    const rules = await loadComplianceRules(srv, emp.jurisdiction || 'IN-DEFAULT');
    const dailyTotal = Number(regularShiftHours) + otHours;
    if (dailyTotal > rules.dailyMaxHours) {
        isBlocked = true;
        messages.push(`Daily limit exceeded: ${dailyTotal}h > ${rules.dailyMaxHours}h (regular ${regularShiftHours}h + OT ${otHours}h).`);
    }

    const agg = await aggregateOvertime(srv, employeeNo, workDate);
    const weekOtHours = Math.round(((agg.weekOtMinutes + otMinutes) / 60) * 100) / 100;
    const weekRegHours = Math.round(((agg.weekRegularMinutes) / 60) * 100) / 100 + Number(regularShiftHours);
    const weekTotal = weekRegHours + weekOtHours;
    if (weekOtHours > rules.weeklyOTAllowance) {
        isBlocked = true;
        messages.push(`Weekly OT allowance exceeded: ${weekOtHours}h > ${rules.weeklyOTAllowance}h.`);
    }
    if (weekTotal > rules.weeklyMaxHours) {
        isBlocked = true;
        messages.push(`Weekly combined limit exceeded: ${weekTotal}h > ${rules.weeklyMaxHours}h.`);
    }

    const quarterOtHours = Math.round(((agg.quarterOtMinutes + otMinutes) / 60) * 100) / 100;
    if (quarterOtHours > rules.quarterlyOTLimit) {
        isBlocked = true;
        messages.push(`Quarterly OT statutory limit exceeded: ${quarterOtHours}h > ${rules.quarterlyOTLimit}h.`);
    } else if (quarterOtHours >= rules.quarterlyWarnAt) {
        messages.push(`Compliance warning: quarterly OT ${quarterOtHours}h approaching limit ${rules.quarterlyOTLimit}h.`);
    }

    if (messages.length === 0) messages.push('Overtime request passes all validations.');
    return {
        otMinutes, otHours, otType, multiplier, baseHourlyRate, estimatedAmount, compOffCredits,
        isBlocked, complianceMessages: messages.join(' | '),
        compliance: { dailyTotal, weekOtHours, weekTotal, quarterOtHours, rules },
    };
}

/** Upsert EmployeeWorkHours when an overtime request is approved. */
async function recordWorkHours(srv, request) {
    const wk = du.isoWeekKey(request.workDate);
    const qk = du.quarterKey(request.workDate);
    const existing = await cds.db.run(
        SELECT.one.from('my.hr.EmployeeWorkHours')
            .where({ employee_ID: request.employeeNo, workDate: request.workDate })
    );
    const regularMinutes = Math.round(Number(request.regularShiftHours || 0) * 60);
    const otMinutes = Number(request.otMinutes || 0);
    if (existing) {
        const newOt = (existing.otMinutes || 0) + otMinutes;
        const newReg = Math.max(existing.regularMinutes || 0, regularMinutes);
        await srv.run(UPDATE('EmployeeWorkHours').set({
            otMinutes: newOt, regularMinutes: newReg,
            totalHours: Math.round(((newReg + newOt) / 60) * 100) / 100,
        }).where({ ID: existing.ID }));
    } else {
        await srv.run(INSERT.into('EmployeeWorkHours').entries({
            employee_ID: request.employeeNo, workDate: request.workDate, weekKey: wk, quarterKey: qk,
            regularMinutes, otMinutes,
            totalHours: Math.round(((regularMinutes + otMinutes) / 60) * 100) / 100,
        }));
    }
}

/** Grant comp-off credits: insert a CompOffTransaction and bump COMP leave balance. */
async function grantCompOff(srv, request) {
    if (!request.convertToCompOff || !request.compOffCredits) return;
    const bal = await cds.db.run(
        SELECT.one.from('my.hr.LeaveBalances')
            .where({ employee_ID: request.employeeNo, leaveType_code: 'COMP' })
    );
    let balAfter = 0;
    if (bal) {
        balAfter = Math.round((Number(bal.totalEntitlement) + Number(request.compOffCredits)) * 100) / 100;
        await srv.run(UPDATE('LeaveBalances').set({
            totalEntitlement: balAfter,
            available: balAfter - Number(bal.used || 0) - Number(bal.pending || 0),
        }).where({ ID: bal.ID }));
    } else {
        balAfter = Number(request.compOffCredits);
        await srv.run(INSERT.into('LeaveBalances').entries({
            employee_ID: request.employeeNo, leaveType_code: 'COMP',
            totalEntitlement: balAfter, used: 0, pending: 0, available: balAfter, allowNegative: false,
        }));
    }
    await srv.run(INSERT.into('CompOffTransactions').entries({
        employee_ID: request.employeeNo, sourceType: 'OVERTIME', sourceRequest_ID: request.ID,
        creditsEarned: Number(request.compOffCredits), creditsUsed: 0, balanceAfter: balAfter,
        transactionDate: request.workDate, reason: `Comp-off from overtime ${request.ID}`,
    }));
}

module.exports = {
    detectOtType, loadOvertimePolicy, loadComplianceRules,
    calculateOvertime, findOvertimeOverlap, findLeaveOverlap, findShiftOverlap,
    aggregateOvertime, recordWorkHours, grantCompOff,
};
