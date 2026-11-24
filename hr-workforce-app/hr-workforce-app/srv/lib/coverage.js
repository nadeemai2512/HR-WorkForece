'use strict';
/**
 * coverage.js — team staffing coverage validation.
 * Before a manager approves leave, we check that approving it does not drop
 * the department below its configured minimum coverage threshold.
 */
const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const du = require('./dateUtils');

/** Active employees in a department. */
async function activeHeadcount(srv, departmentCode) {
    const rows = await cds.db.run(
        SELECT.from('my.hr.Employees')
            .where({ department_code: departmentCode, status: 'ACTIVE' })
    );
    return rows;
}

/** Employees of a department who are on approved leave for any date in [start,end]. */
async function employeesOnLeave(srv, departmentCode, start, end, excludeRequestId = null) {
    const sd = du.toDateString(start);
    const ed = du.toDateString(end);
    const q = SELECT.from('my.hr.LeaveRequests')
        .where({ department_code: departmentCode, status: 'APPROVED' })
        .and('startDate <=', ed)
        .and('endDate >=', sd);
    if (excludeRequestId) q.and('ID !=', excludeRequestId);
    return cds.db.run(q);
}

/**
 * Returns per-date staffing breakdown + a boolean `belowThreshold` flag and a
 * human-readable message. Threshold defaults to 70%.
 */
async function evaluateCoverage(srv, { departmentCode, startDate, endDate, excludeRequestId = null }) {
    const dept = await cds.db.run(SELECT.one.from('Departments').where({ code: departmentCode }));
    const thresholdPct = (dept && dept.minCoveragePercent) ? dept.minCoveragePercent : 70;
    const head = await activeHeadcount(srv, departmentCode);
    const headcount = head.length;
    if (headcount === 0) {
        return { headcount: 0, thresholdPct, staffingPercent: 0, belowThreshold: true,
                 message: 'Department has no active employees; coverage cannot be evaluated.' };
    }

    // Precompute leave membership per date.
    const onLeave = await employeesOnLeave(srv, departmentCode, startDate, endDate, excludeRequestId);
    const onLeaveByDate = new Map(); // dateStr -> Set(employee_ID)
    for (const lr of onLeave) {
        for (const d of du.eachDay(lr.startDate, lr.endDate)) {
            const k = du.toDateString(d);
            if (!onLeaveByDate.has(k)) onLeaveByDate.set(k, new Set());
            onLeaveByDate.get(k).add(lr.employee_ID);
        }
    }

    let worstPct = 100;
    const perDate = [];
    for (const d of du.eachDay(startDate, endDate)) {
        if (du.isWeekend(d)) continue; // coverage only matters on working days
        const k = du.toDateString(d);
        const absent = onLeaveByDate.get(k)?.size || 0;
        const present = Math.max(0, headcount - absent);
        const pct = Math.round((present / headcount) * 1000) / 10;
        worstPct = Math.min(worstPct, pct);
        perDate.push({ date: k, present, absent, staffingPercent: pct });
    }

    const belowThreshold = worstPct < thresholdPct;
    const message = belowThreshold
        ? `Coverage warning: approving this leave drops department staffing to ${worstPct}% on at least one working day (minimum ${thresholdPct}%). A documented override is required.`
        : `Coverage OK: worst-case staffing ${worstPct}% (minimum ${thresholdPct}%).`;

    return { headcount, thresholdPct, staffingPercent: worstPct, belowThreshold, message, perDate };
}

module.exports = { activeHeadcount, employeesOnLeave, evaluateCoverage };
