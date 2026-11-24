'use strict';
/**
 * restPeriod.js — minimum rest period validation between consecutive shifts.
 * Default 11 hours, configurable per jurisdiction via ComplianceRules.minRestHours.
 * Handles overnight / cross-midnight shifts by anchoring every shift on an
 * absolute minute timeline relative to the new shift's start day.
 */
const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const du = require('./dateUtils');

async function loadMinRestHours(srv, jurisdiction) {
    const asOf = du.toDateString(new Date());
    const rule = await cds.db.run(
        SELECT.one.from('my.hr.ComplianceRules')
            .where({ jurisdiction })
            .and('effectiveFrom <=', asOf)
            .and('effectiveTo is null or effectiveTo >=', asOf)
    );
    return rule?.minRestHours ?? 11;
}

/** Convert an assignment to absolute minutes relative to `anchorDate` 00:00. */
function toAbsolute(assignment, anchorDate) {
    const dayDiff = Math.round(
        (du.toDate(assignment.shiftDate).getTime() - du.toDate(anchorDate).getTime()) / 86400000
    );
    const startInDay = du.hhmmToMinutes(assignment.startTime);
    let endInDay = du.hhmmToMinutes(assignment.endTime);
    if (endInDay <= startInDay) endInDay += 24 * 60; // crosses midnight within its own day
    return {
        startAbs: startInDay + dayDiff * 24 * 60,
        endAbs: endInDay + dayDiff * 24 * 60,
        assignment,
    };
}

/**
 * Validate that placing a shift (date/start/end/crossesMidnight) leaves at least
 * minRestHours before and after relative to neighbouring assignments.
 */
async function validateRestPeriod(srv, { employeeNo, shiftDate, startTime, endTime, crossesMidnight, excludeAssignmentId = null }) {
    const emp = await cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo }));
    if (!emp) return { ok: false, minRestHours: 11, messages: 'Employee not found.' };

    const minRestHours = await loadMinRestHours(srv, emp.jurisdiction || 'IN-DEFAULT');
    const minRestMinutes = minRestHours * 60;

    const anchor = du.toDate(shiftDate);
    const from = du.toDateString(du.addDays(anchor, -2));
    const to = du.toDateString(du.addDays(anchor, 2));

    const q = SELECT.from('my.hr.ShiftAssignments')
        .where({ employee_ID: employeeNo, status: 'ASSIGNED' })
        .and('shiftDate >=', from)
        .and('shiftDate <=', to);
    if (excludeAssignmentId) q.and('ID !=', excludeAssignmentId);
    const neighbours = await cds.db.run(q);

    const candidate = toAbsolute({
        shiftDate, startTime, endTime, crossesMidnight: !!crossesMidnight,
    }, anchor);
    const abs = neighbours.map(a => toAbsolute(a, anchor));

    const violations = [];
    const messages = [];
    // Previous shift = largest endAbs strictly before candidate.startAbs
    const prev = abs.filter(a => a.endAbs <= candidate.startAbs)
                    .sort((a, b) => b.endAbs - a.endAbs)[0];
    if (prev) {
        const rest = candidate.startAbs - prev.endAbs;
        if (rest < minRestMinutes) {
            const hh = Math.floor(rest / 60), mm = rest % 60;
            const msg =
                `Insufficient rest before shift: only ${hh}h${String(mm).padStart(2, '0')}m ` +
                `between previous shift ending ${prev.assignment.endTime} on ${prev.assignment.shiftDate} ` +
                `and this shift starting ${startTime} (minimum ${minRestHours}h).`;
            violations.push(msg); messages.push(msg);
        }
    }
    // Next shift = smallest startAbs strictly after candidate.endAbs
    const next = abs.filter(a => a.startAbs >= candidate.endAbs)
                    .sort((a, b) => a.startAbs - b.startAbs)[0];
    if (next) {
        const rest = next.startAbs - candidate.endAbs;
        if (rest < minRestMinutes) {
            const hh = Math.floor(rest / 60), mm = rest % 60;
            const msg =
                `Insufficient rest after shift: only ${hh}h${String(mm).padStart(2, '0')}m ` +
                `between this shift ending ${endTime} and next shift starting ${next.assignment.startTime} ` +
                `on ${next.assignment.shiftDate} (minimum ${minRestHours}h).`;
            violations.push(msg); messages.push(msg);
        }
    }
    if (violations.length === 0) messages.push(`Rest period OK (minimum ${minRestHours}h).`);
    return { ok: violations.length === 0, minRestHours, messages: messages.join(' | ') };
}

module.exports = { loadMinRestHours, validateRestPeriod, toAbsolute };
