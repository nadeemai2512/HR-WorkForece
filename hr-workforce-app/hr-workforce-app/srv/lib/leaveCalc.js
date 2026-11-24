'use strict';
/**
 * leaveCalc.js — leave validation & balance logic (reusable, server-side).
 * Every function receives the CAP service/transaction `srv` so it runs inside
 * the caller's request transaction. `employee_ID` columns hold the business
 * key `employeeNo` (see schema on-condition).
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const du = require('./dateUtils');

const ACTIVE_LEAVE = ['SUBMITTED', 'PENDING_MANAGER', 'APPROVED'];

async function loadHolidays(srv, jurisdiction = 'ALL') {
    const h = await cds.db.run(
        SELECT.from('my.hr.CompanyHolidays')
            .where('jurisdiction =', 'ALL', 'or jurisdiction =', jurisdiction || 'ALL')
    );
    return h.map(r => ({ holidayDate: r.holidayDate, halfDay: r.halfDay }));
}

async function loadBlackouts(srv, jurisdiction, leaveTypeCode) {
    const rows = await cds.db.run(
        SELECT.from('my.hr.BlackoutPeriods')
            .where('jurisdiction =', 'ALL', 'or jurisdiction =', jurisdiction || 'ALL')
    );
    return rows.filter(b => {
        if (b.appliesToAllLeaveTypes) return true;
        const list = (b.leaveTypes || '').split(',').map(s => s.trim()).filter(Boolean);
        return list.includes(leaveTypeCode);
    });
}

async function loadLeavePolicy(srv, leaveTypeCode, asOfDate = new Date()) {
    const lt = await cds.db.run(SELECT.one.from('my.hr.LeaveTypes').where({ code: leaveTypeCode }));
    if (!lt) return null;
    const asOf = du.toDateString(asOfDate);
    const policy = await cds.db.run(
        SELECT.one.from('my.hr.LeavePolicies')
            .where({ leaveType_code: leaveTypeCode })
            .and('effectiveFrom <=', asOf)
            .and('effectiveTo is null or effectiveTo >=', asOf)
    );
    return { leaveType: lt, policy };
}

async function loadBalance(srv, employeeNo, leaveTypeCode) {
    return cds.db.run(
        SELECT.one.from('my.hr.LeaveBalances')
            .where({ employee_ID: employeeNo, leaveType_code: leaveTypeCode })
    );
}

async function findOverlap(srv, employeeNo, startDate, endDate, excludeId = null) {
    const q = SELECT.one.from('my.hr.LeaveRequests')
        .where({ employee_ID: employeeNo })
        .and('status in', ACTIVE_LEAVE)
        .and('startDate <=', du.toDateString(endDate))
        .and('endDate >=', du.toDateString(startDate));
    if (excludeId) q.and('ID !=', excludeId);
    return cds.db.run(q);
}

/**
 * Core: calculate working days and run all pre-submission checks.
 * Returns { workingDays, isBlocked, medicalCertRequired, messages }.
 */
async function calculateLeaveDays(srv, { employeeNo, leaveTypeCode, startDate, endDate }) {
    const messages = [];
    let isBlocked = false;
    let medicalCertRequired = false;

    const emp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo }));
    if (!emp) {
        return { workingDays: 0, isBlocked: true, medicalCertRequired: false, messages: 'Employee not found.' };
    }

    const { leaveType, policy } = (await loadLeavePolicy(srv, leaveTypeCode, new Date())) || {};
    if (!leaveType) {
        return { workingDays: 0, isBlocked: true, medicalCertRequired: false, messages: `Unknown leave type ${leaveTypeCode}.` };
    }

    const start = du.toDate(startDate);
    const end = du.toDate(endDate);
    if (end < start) {
        return { workingDays: 0, isBlocked: true, medicalCertRequired: false, messages: 'End date must be on or after start date.' };
    }

    const holidays = await loadHolidays(srv, emp.jurisdiction || 'ALL');
    const workingDays = du.workingDaysBetween(start, end, holidays);

    // 1. Blackout check (Sick Leave exempt via leaveType.exemptFromBlackout)
    if (!leaveType.exemptFromBlackout) {
        const blackouts = await loadBlackouts(srv, emp.jurisdiction || 'ALL', leaveTypeCode);
        const hit = blackouts.find(b => !(end < du.toDate(b.startDate) || start > du.toDate(b.endDate)));
        if (hit) {
            isBlocked = true;
            messages.push(`Leave blocked by blackout period ${du.toDateString(hit.startDate)} → ${du.toDateString(hit.endDate)} (${hit.reason || 'no reason given'}).`);
        }
    }

    // 2. Advance-notice check (Sick Leave exempt)
    if (!leaveType.exemptFromAdvanceNotice && policy) {
        const today = du.toDate(new Date());
        const advanceGiven = du.calendarDaysBetween(today, start);
        if (workingDays > (policy.longLeaveThresholdDays || 3) &&
            advanceGiven < (policy.minAdvanceDaysForLongLeave || 7)) {
            isBlocked = true;
            messages.push(
                `Leave longer than ${policy.longLeaveThresholdDays || 3} working days must be submitted ` +
                `at least ${policy.minAdvanceDaysForLongLeave || 7} calendar days in advance ` +
                `(only ${advanceGiven} day(s) given).`
            );
        }
    }

    // 3. Medical certificate requirement for Sick Leave > threshold consecutive calendar days
    if (leaveType.code === 'SL' || leaveType.medicalCertThresholdDays > 0) {
        const consecutiveCalendar = du.calendarDaysBetween(start, end);
        if (consecutiveCalendar > (leaveType.medicalCertThresholdDays || 2)) {
            medicalCertRequired = true;
            messages.push(`Medical certificate required: Sick Leave exceeds ${leaveType.medicalCertThresholdDays || 2} consecutive calendar days.`);
        }
    }

    // 4. Balance check
    const balance = await loadBalance(srv, employeeNo, leaveTypeCode);
    if (balance) {
        const available = balance.available ?? (balance.totalEntitlement - balance.used - balance.pending);
        if (workingDays > available && !balance.allowNegative) {
            isBlocked = true;
            messages.push(`Insufficient balance: requested ${workingDays} day(s), available ${available} day(s). Negative balance not allowed for ${leaveTypeCode}.`);
        }
    }

    // 5. Overlap check
    const overlap = await findOverlap(srv, employeeNo, start, end);
    if (overlap) {
        isBlocked = true;
        messages.push(`Overlapping leave request already exists (${overlap.startDate} → ${overlap.endDate}, status ${overlap.status}).`);
    }

    if (messages.length === 0) messages.push('Leave request passes all validations.');
    return { workingDays, isBlocked, medicalCertRequired, messages: messages.join(' | ') };
}

/** Increase `pending` (and reduce available) when a request is submitted. */
async function reservePending(srv, request) {
    const bal = await loadBalance(srv, request.employeeNo, request.leaveType_code);
    if (!bal) return;
    bal.pending = (bal.pending || 0) + Number(request.days);
    bal.available = (bal.totalEntitlement - bal.used - bal.pending);
    await srv.run(UPDATE('LeaveBalances').set({ pending: bal.pending, available: bal.available }).where({ ID: bal.ID }));
}

/** Move `pending` to `used` when a request is approved. */
async function consumeApproved(srv, request) {
    const bal = await loadBalance(srv, request.employeeNo, request.leaveType_code);
    if (!bal) return;
    bal.pending = Math.max(0, (bal.pending || 0) - Number(request.days));
    bal.used = (bal.used || 0) + Number(request.days);
    bal.available = (bal.totalEntitlement - bal.used - bal.pending);
    await srv.run(UPDATE('LeaveBalances').set({ pending: bal.pending, used: bal.used, available: bal.available }).where({ ID: bal.ID }));
}

/** Release pending reservation when a request is rejected / cancelled / sent back. */
async function releasePending(srv, request) {
    const bal = await loadBalance(srv, request.employeeNo, request.leaveType_code);
    if (!bal) return;
    bal.pending = Math.max(0, (bal.pending || 0) - Number(request.days));
    bal.available = (bal.totalEntitlement - bal.used - bal.pending);
    await srv.run(UPDATE('LeaveBalances').set({ pending: bal.pending, available: bal.available }).where({ ID: bal.ID }));
}

module.exports = {
    loadHolidays, loadBlackouts, loadLeavePolicy, loadBalance, findOverlap,
    calculateLeaveDays, reservePending, consumeApproved, releasePending,
    ACTIVE_LEAVE,
};
