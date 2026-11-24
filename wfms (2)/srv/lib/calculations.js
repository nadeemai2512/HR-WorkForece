/**
 * wfms/srv/lib/calculations.js
 *
 * Pure, reusable validation + computation functions used by every service
 * handler. No CAP handler should re-implement any of this logic; it should
 * call into this module so that leave/shift/overtime/compliance rules are
 * evaluated consistently on submit AND on approval.
 *
 * Every function that needs DB state takes a `tx` (cds transaction) so it can
 * run inside the caller's transaction and rollback atomically on failure.
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;

/* ----------------------------------------------------------
 * Time helpers
 * ---------------------------------------------------------- */

/** "06:00" -> 360 minutes since midnight. Cross-day aware (next day if end <= start). */
function timeToMinutes(t) {
    if (!t || typeof t !== 'string') return null;
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
}

/** Duration in minutes between start and end; if end<=start, treat as overnight (next day). */
function durationMinutes(start, end) {
    const s = timeToMinutes(start);
    let e = timeToMinutes(end);
    if (s === null || e === null) return 0;
    if (e <= s) e += 24 * 60; // overnight
    return e - s;
}

/** Minutes since midnight -> "HH:MM" */
function minutesToTime(mins) {
    if (mins == null) return null;
    let m = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** JS Date -> "YYYY-MM-DD" (local) */
function isoDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Add n calendar days to a date */
function addDays(d, n) {
    const dt = d instanceof Date ? new Date(d) : new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}

/** 0 = Sunday ... 6 = Saturday */
function weekday(d) {
    return (d instanceof Date ? d : new Date(d)).getDay();
}

const isWeekend = d => {
    const w = weekday(d);
    return w === 0 || w === 6;
};

/* ----------------------------------------------------------
 * Holidays
 * ---------------------------------------------------------- */

/** Return Set of ISO date strings for holidays applying to the employee's country/region. */
async function holidaysFor(tx, country, region) {
    const rows = await tx.run(
        SELECT.from('wfms.CompanyHolidays')
            .where `country = ${country} and (region = ${region || null} or region is null)`
    );
    return new Set(rows.map(r => isoDate(r.holidayDate)));
}

/* ----------------------------------------------------------
 * Leave day calculation
 * ---------------------------------------------------------- */

/**
 * Working leave days between startDate and endDate inclusive.
 * - Excludes weekends (Sat/Sun)
 * - Excludes company holidays for the employee's country/region
 * - If isHalfDay and start==end, returns 0.5
 * Returns a Decimal-string like "3" or "0.5".
 */
async function calcLeaveDays(tx, employee_ID, leaveType_ID, startDate, endDate, isHalfDay) {
    const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: employee_ID }));
    if (!emp) throw new Error(`Employee ${employee_ID} not found`);
    const hols = await holidaysFor(tx, emp.country, emp.region);

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) throw new Error('endDate must be on or after startDate');

    let days = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        if (isWeekend(d)) continue;
        if (hols.has(isoDate(d))) continue;
        days += 1;
    }
    if (isHalfDay && isoDate(start) === isoDate(end) && days === 1) {
        days = 0.5;
    }
    return days.toFixed(1);
}

/* ----------------------------------------------------------
 * Blackout / advance notice / medical certificate
 * ---------------------------------------------------------- */

/** Returns the matching BlackoutPeriod row if any date in [start,end] falls in an active blackout. */
async function blackoutHit(tx, emp, startDate, endDate, leaveTypeCode) {
    const periods = await tx.run(
        SELECT.from('wfms.BlackoutPeriods').where `active = true and country = ${emp.country} and (region = ${emp.region || null} or region is null)`
    );
    const s = new Date(startDate);
    const e = new Date(endDate);
    for (const p of periods) {
        const ps = new Date(p.startDate);
        const pe = new Date(p.endDate);
        if (e < ps || s > pe) continue;
        const applies = p.appliesToLeaveTypes ? p.appliesToLeaveTypes.split(',').map(x => x.trim()) : null;
        if (applies && applies.length && !applies.includes(leaveTypeCode)) continue;
        return p;
    }
    return null;
}

/** Minimum advance-notice check. Returns { ok, message } based on the active leave policy. */
async function checkAdvanceNotice(tx, emp, leaveType, startDate, endDate, daysRequested) {
    if (leaveType.exemptFromAdvanceNotice) return { ok: true, message: null };
    const policy = await tx.run(SELECT.one.from('wfms.LeavePolicies').where `leaveType_ID = ${leaveType.ID} and active = true and country = ${emp.country}`.orderBy `effectiveFrom desc`);
    if (!policy || !policy.minAdvanceNoticeDays) return { ok: true, message: null };
    // Notice only applies to requests longer than threshold
    if (policy.advanceNoticeThresholdDays && Number(daysRequested) <= policy.advanceNoticeThresholdDays) {
        return { ok: true, message: null };
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(startDate); start.setHours(0, 0, 0, 0);
    const noticeDays = Math.round((start - today) / 86400000);
    if (noticeDays < policy.minAdvanceNoticeDays) {
        return {
            ok: false,
            message: `Requests exceeding ${policy.advanceNoticeThresholdDays} working days must be submitted at least ${policy.minAdvanceNoticeDays} calendar days in advance. Current advance: ${noticeDays} day(s).`
        };
    }
    return { ok: true, message: null };
}

/** Sick leave requires a medical certificate when consecutive calendar days exceed threshold. */
function requiresMedicalCertificate(leaveType, calendarDays) {
    const threshold = leaveType.requireCertificateAfterDays || 0;
    return threshold > 0 && calendarDays > threshold;
}

/* ----------------------------------------------------------
 * Leave balance validation
 * ---------------------------------------------------------- */

/**
 * Returns { ok, message } - whether the employee has enough available balance.
 * available = entitlement + carryForward - used - pending.
 * Negative balance allowed only when LeaveTypes.allowNegativeBalance = true.
 */
async function checkLeaveBalance(tx, employee_ID, leaveType_ID, daysRequested, year = new Date().getFullYear()) {
    const lt = await tx.run(SELECT.one.from('wfms.LeaveTypes').where({ ID: leaveType_ID }));
    if (!lt) throw new Error('Leave type not found');
    let bal = await tx.run(
        SELECT.one.from('wfms.LeaveBalances')
            .where `employee_ID = ${employee_ID} and leaveType_ID = ${leaveType_ID} and year = ${year}`
    );
    if (!bal) {
        // auto-provision a balance from the default entitlement
        bal = { entitlement: Number(lt.defaultEntitlementDays), carryForward: 0, used: 0, pending: 0, available: Number(lt.defaultEntitlementDays) };
    }
    const requested = Number(daysRequested);
    const available = Number(bal.available);
    if (requested > available && !lt.allowNegativeBalance) {
        return { ok: false, message: `Insufficient balance: requested ${requested} day(s), available ${available} day(s). Negative balance not allowed for ${lt.code}.`, balance: bal };
    }
    return { ok: true, message: null, balance: bal };
}

/** Detect overlapping leave requests for the same employee (excludes Cancelled/Rejected). */
async function hasOverlappingLeave(tx, employee_ID, startDate, endDate, excludeRequest_ID = null) {
    const rows = await tx.run(
        SELECT.from('wfms.LeaveRequests')
            .where `employee_ID = ${employee_ID} and status not in ('Cancelled','Rejected','Draft')
                    and startDate <= ${endDate} and endDate >= ${startDate}`
    );
    if (excludeRequest_ID) return rows.filter(r => r.ID !== excludeRequest_ID).length > 0;
    return rows.length > 0;
}

/**
 * Atomically apply a delta to a leave balance row inside the caller's tx.
 * Fetches the row first, computes new values, then UPDATEs by ID. This avoids
 * CQN arithmetic-in-set quirks and keeps pending/used/available consistent.
 * @param {object} deltas - { pending, used, available } numeric deltas (can be partial)
 */
async function applyBalanceDelta(tx, employee_ID, leaveType_ID, year, deltas) {
    let bal = await tx.run(
        SELECT.one.from('wfms.LeaveBalances')
            .where `employee_ID = ${employee_ID} and leaveType_ID = ${leaveType_ID} and year = ${year}`
    );
    if (!bal) {
        // auto-provision from leave type default
        const lt = await tx.run(SELECT.one.from('wfms.LeaveTypes').where({ ID: leaveType_ID }));
        bal = { ID: null, entitlement: Number(lt?.defaultEntitlementDays || 0), carryForward: 0, used: 0, pending: 0, available: Number(lt?.defaultEntitlementDays || 0) };
        const ins = await tx.run(INSERT.into('wfms.LeaveBalances').entries({
            employee_ID, leaveType_ID, year,
            entitlement: bal.entitlement, carryForward: 0, used: 0, pending: 0, available: bal.available
        }));
        bal.ID = ins.results?.[0]?.ID || ins.ID;
    }
    const update = {};
    if (deltas.pending != null)  update.pending  = Number(bal.pending)  + Number(deltas.pending);
    if (deltas.used != null)     update.used     = Number(bal.used)     + Number(deltas.used);
    if (deltas.available != null) update.available = Number(bal.available) + Number(deltas.available);
    if (deltas.entitlement != null) update.entitlement = Number(bal.entitlement) + Number(deltas.entitlement);
    await tx.run(UPDATE('wfms.LeaveBalances').set(update).where({ ID: bal.ID }));
}

/* ----------------------------------------------------------
 * Team coverage
 * ---------------------------------------------------------- */

/**
 * Department staffing % if the given leave is approved.
 * present = active employees minus those on approved leave on each date;
 * we use the lowest staffing % across the requested range.
 */
async function previewTeamCoverage(tx, leaveRequest_ID) {
    const lr = await tx.run(SELECT.one.from('wfms.LeaveRequests').where({ ID: leaveRequest_ID }));
    if (!lr) throw new Error('Leave request not found');
    const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: lr.employee_ID }));
    if (!emp) throw new Error('Employee not found');
    const dept = await tx.run(SELECT.one.from('wfms.Departments').where({ ID: emp.department_ID }));
    const minPct = dept && dept.minCoveragePct ? Number(dept.minCoveragePct) : 70;

    const teamRows = await tx.run(
        SELECT.from('wfms.Employees')
            .where `department_ID = ${emp.department_ID} and status = 'Active'`
    );
    const headcount = teamRows.length;
    if (headcount === 0) return { pct: 100, minPct, headcount, present: 0, message: 'No active team members' };

    const start = new Date(lr.startDate);
    const end = new Date(lr.endDate);
    let lowest = 100;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        const dayIso = isoDate(d);
        // count team members on approved leave on this day (excluding the requestor)
        const onLeave = await tx.run(
            SELECT.from('wfms.LeaveRequests')
                .where `status = 'Approved'
                        and startDate <= ${dayIso} and endDate >= ${dayIso}
                        and employee_ID in ${teamRows.map(r => r.ID)}`
        );
        const present = headcount - onLeave.length;
        const pct = Math.round((present / headcount) * 10000) / 100;
        if (pct < lowest) lowest = pct;
    }
    return { pct: lowest, minPct, headcount, present: Math.ceil(headcount * lowest / 100) };
}

/* ----------------------------------------------------------
 * Shift rest period
 * ---------------------------------------------------------- */

/**
 * Minimum rest period check (default 11h, configurable in ComplianceRules).
 * Inspects the employee's shift on the previous calendar day (if shift ended
 * overnight into 'date') and on the same day before startTime.
 * Returns "" if ok, or a human-readable violation message.
 */
async function validateRestPeriod(tx, employee_ID, date, startTime, endTime) {
    const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: employee_ID }));
    if (!emp) throw new Error('Employee not found');
    const rules = await activeComplianceRule(tx, emp);
    const minRestMin = Math.round(Number(rules.minRestHours) * 60);

    const newStartMin = timeToMinutes(startTime);
    // Look at the previous day's shift to handle overnight endings (e.g. night shift ends 06:30 next day)
    const prevDate = isoDate(addDays(date, -1));
    const prevShifts = await tx.run(
        SELECT.from('wfms.ShiftAssignments').where `employee_ID = ${employee_ID} and assignmentDate = ${prevDate} and status not in ('Cancelled')`
    );
    for (const ps of prevShifts) {
        const psStart = timeToMinutes(ps.startTime);
        let psEnd = timeToMinutes(ps.endTime);
        if (psEnd <= psStart) psEnd += 24 * 60; // overnight
        // rest = (midnight of `date`) + newStartMin - psEnd_in_minutes_since_prev_day_midnight
        const rest = (24 * 60 + newStartMin) - psEnd;
        if (rest < minRestMin) {
            return `Insufficient rest period: previous shift on ${prevDate} ends at ${ps.endTime}; only ${Math.round(rest / 60 * 10) / 10}h rest before ${startTime} on ${isoDate(date)}. Minimum required: ${rules.minRestHours}h.`;
        }
    }
    // Same-day earlier shift
    const sameDay = await tx.run(
        SELECT.from('wfms.ShiftAssignments').where `employee_ID = ${employee_ID} and assignmentDate = ${isoDate(date)} and status not in ('Cancelled')`
    );
    for (const ss of sameDay) {
        const ssStart = timeToMinutes(ss.startTime);
        let ssEnd = timeToMinutes(ss.endTime);
        if (ssEnd <= ssStart) ssEnd += 24 * 60;
        // gap between new shift start and an earlier same-day shift end
        if (ssEnd <= newStartMin) {
            const rest = newStartMin - ssEnd;
            if (rest < minRestMin) {
                return `Insufficient rest period: shift ${ss.startTime}-${ss.endTime} on ${isoDate(date)} leaves only ${Math.round(rest / 60 * 10) / 10}h before ${startTime}. Minimum required: ${rules.minRestHours}h.`;
            }
        }
    }
    return '';
}

/* ----------------------------------------------------------
 * Active policy resolution
 * ---------------------------------------------------------- */

async function activeComplianceRule(tx, emp) {
    const rows = await tx.run(
        SELECT.from('wfms.ComplianceRules')
            .where `active = true and country = ${emp.country} and (region = ${emp.region || null} or region is null) and employeeCategory = ${emp.employeeCategory}`
            .orderBy `effectiveFrom desc`
    );
    const today = new Date();
    for (const r of rows) {
        if (r.effectiveFrom && new Date(r.effectiveFrom) > today) continue;
        if (r.effectiveTo && new Date(r.effectiveTo) < today) continue;
        return r;
    }
    // fallback to the global default (no country/region match)
    const fallback = await tx.run(SELECT.one.from('wfms.ComplianceRules').where `active = true and country is null`.orderBy `effectiveFrom desc`);
    return fallback || {
        dailyMaxHours: 12, weeklyRegularHours: 48, weeklyMaxOvertime: 12,
        weeklyMaxTotalHours: 60, quarterlyOvertimeLimit: 50, minRestHours: 11, warningThresholdPct: 80
    };
}

async function activeOvertimePolicy(tx, emp) {
    const rows = await tx.run(
        SELECT.from('wfms.OvertimePolicies')
            .where `active = true and country = ${emp.country} and (region = ${emp.region || null} or region is null)`
            .orderBy `effectiveFrom desc`
    );
    const today = new Date();
    for (const r of rows) {
        if (r.effectiveFrom && new Date(r.effectiveFrom) > today) continue;
        if (r.effectiveTo && new Date(r.effectiveTo) < today) continue;
        return r;
    }
    return { weekdayMultiplier: 1.5, weekendMultiplier: 2.0, publicHolidayMultiplier: 2.5, compOffConversionHours: 0 };
}

/* ----------------------------------------------------------
 * Overtime calculation
 * ---------------------------------------------------------- */

/** Returns { type, minutes, multiplier, amount, compOffCredits } JSON-string. */
async function calcOvertime(tx, employee_ID, workDate, otStart, otEnd) {
    const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: employee_ID }));
    if (!emp) throw new Error('Employee not found');
    const policy = await activeOvertimePolicy(tx, emp);
    const hols = await holidaysFor(tx, emp.country, emp.region);
    const minutes = durationMinutes(otStart, otEnd);
    if (minutes <= 0) throw new Error('Overtime end must be after start (or overnight).');

    let type = 'Weekday';
    const d = new Date(workDate);
    if (hols.has(isoDate(d))) type = 'PublicHoliday';
    else if (isWeekend(d)) type = 'Weekend';

    const multiplier = type === 'PublicHoliday' ? Number(policy.publicHolidayMultiplier)
                     : type === 'Weekend' ? Number(policy.weekendMultiplier)
                     : Number(policy.weekdayMultiplier);

    const hours = minutes / 60;
    const baseHourlyRate = Number(emp.hourlyBaseRate) || 0;
    const amount = Math.round(hours * multiplier * baseHourlyRate * 100) / 100;

    const compOffConversionHours = Number(policy.compOffConversionHours) || 0;
    const compOffCredits = compOffConversionHours > 0 ? Math.round(hours / compOffConversionHours * 10) / 10 : 0;

    return JSON.stringify({
        type, minutes, hours: Math.round(hours * 100) / 100, multiplier,
        baseHourlyRate, estimatedAmount: amount, compOffCredits, compOffConversionHours
    });
}

/* ----------------------------------------------------------
 * Overtime compliance limits
 * ---------------------------------------------------------- */

/**
 * Returns { ok, warnings[], error } covering daily, weekly and quarterly limits.
 * `additionalMinutes` = minutes of OT being requested (in addition to already-approved).
 */
async function checkOvertimeCompliance(tx, emp, workDate, additionalMinutes) {
    const rule = await activeComplianceRule(tx, emp);
    const warnings = [];
    const dayIso = isoDate(workDate);

    // ----- Daily limit (regular + OT) -----
    const dayRows = await tx.run(
        SELECT.from('wfms.EmployeeWorkHours').where `employee_ID = ${emp.ID} and workDate = ${dayIso}`
    );
    let dayRegular = 0, dayOvertime = 0;
    for (const r of dayRows) { dayRegular += r.regularMinutes || 0; dayOvertime += r.overtimeMinutes || 0; }
    // Add a default 8h regular if no timesheet row exists (configurable later)
    if (dayRegular === 0) dayRegular = 8 * 60;
    const projectedDailyHours = (dayRegular + dayOvertime + additionalMinutes) / 60;
    const dailyMax = Number(rule.dailyMaxHours);
    if (projectedDailyHours > dailyMax) {
        return { ok: false, warnings, error: `Daily limit exceeded: projected ${projectedDailyHours.toFixed(1)}h, max ${dailyMax}h/day.` };
    }

    // ----- Weekly limit -----
    const monday = startOfWeek(new Date(workDate));
    const sunday = addDays(monday, 6);
    const weekRows = await tx.run(
        SELECT.from('wfms.EmployeeWorkHours').where `employee_ID = ${emp.ID} and workDate >= ${isoDate(monday)} and workDate <= ${isoDate(sunday)}`
    );
    let weekRegular = 0, weekOvertime = 0;
    for (const r of weekRows) { weekRegular += r.regularMinutes || 0; weekOvertime += r.overtimeMinutes || 0; }
    if (weekRegular === 0) weekRegular = 8 * 60 * 5; // default 5-day week
    const projectedWeeklyRegular = weekRegular / 60;
    const projectedWeeklyOvertime = (weekOvertime + additionalMinutes) / 60;
    const projectedWeeklyTotal = projectedWeeklyRegular + projectedWeeklyOvertime;
    const weeklyRegularMax = Number(rule.weeklyRegularHours);
    const weeklyOTMax = Number(rule.weeklyMaxOvertime);
    const weeklyTotalMax = Number(rule.weeklyMaxTotalHours);
    if (projectedWeeklyTotal > weeklyTotalMax) {
        return { ok: false, warnings, error: `Weekly total limit exceeded: projected ${projectedWeeklyTotal.toFixed(1)}h, max ${weeklyTotalMax}h/week.` };
    }
    if (projectedWeeklyOvertime > weeklyOTMax) {
        return { ok: false, warnings, error: `Weekly overtime limit exceeded: projected ${projectedWeeklyOvertime.toFixed(1)}h, max ${weeklyOTMax}h/week.` };
    }

    // ----- Quarterly overtime -----
    const q = quarterBounds(new Date(workDate));
    const qRows = await tx.run(
        SELECT.from('wfms.OvertimeRequests')
            .where `employee_ID = ${emp.ID} and status = 'Approved' and workDate >= ${isoDate(q.start)} and workDate <= ${isoDate(q.end)}`
    );
    const qApprovedMinutes = qRows.reduce((s, r) => s + (r.overtimeMinutes || 0), 0);
    const qProjectedHours = (qApprovedMinutes + additionalMinutes) / 60;
    const qLimit = Number(rule.quarterlyOvertimeLimit);
    const warnPct = Number(rule.warningThresholdPct) || 80;
    if (qProjectedHours > qLimit) {
        return { ok: false, warnings, error: `Quarterly overtime limit exceeded: projected ${qProjectedHours.toFixed(1)}h, statutory max ${qLimit}h/quarter.` };
    }
    if (qProjectedHours >= qLimit * warnPct / 100) {
        warnings.push(`Quarterly overtime approaching limit: ${qProjectedHours.toFixed(1)}h of ${qLimit}h (${Math.round(qProjectedHours / qLimit * 100)}%).`);
    }
    return { ok: true, warnings, error: null };
}

/** Detect overlap of an overtime request with leave, regular shifts, or other OT. */
async function checkOvertimeOverlap(tx, emp, workDate, otStart, otEnd, excludeRequest_ID = null) {
    const dayIso = isoDate(workDate);
    const warnings = [];

    // Overlap with approved leave
    const leaveHit = await tx.run(
        SELECT.one.from('wfms.LeaveRequests')
            .where `employee_ID = ${emp.ID} and status = 'Approved' and startDate <= ${dayIso} and endDate >= ${dayIso}`
    );
    if (leaveHit) warnings.push(`Overlaps with approved leave ${leaveHit.startDate}..${leaveHit.endDate}.`);

    // Overlap with assigned regular shift
    const shifts = await tx.run(
        SELECT.from('wfms.ShiftAssignments')
            .where `employee_ID = ${emp.ID} and assignmentDate = ${dayIso} and status not in ('Cancelled')`
    );
    const newS = timeToMinutes(otStart);
    let newE = timeToMinutes(otEnd);
    if (newE <= newS) newE += 24 * 60;
    for (const s of shifts) {
        const ss = timeToMinutes(s.startTime);
        let se = timeToMinutes(s.endTime);
        if (se <= ss) se += 24 * 60;
        if (newS < se && ss < newE) {
            warnings.push(`Overlaps with assigned shift ${s.startTime}-${s.endTime} on ${dayIso}.`);
        }
    }

    // Overlap with other OT requests
    const otherOt = await tx.run(
        SELECT.from('wfms.OvertimeRequests')
            .where `employee_ID = ${emp.ID} and workDate = ${dayIso} and status in ('Submitted','PendingManager','Approved')`
    );
    for (const o of otherOt) {
        if (excludeRequest_ID && o.ID === excludeRequest_ID) continue;
        const os = timeToMinutes(o.overtimeStart);
        let oe = timeToMinutes(o.overtimeEnd);
        if (oe <= os) oe += 24 * 60;
        if (newS < oe && os < newE) {
            warnings.push(`Overlaps with existing overtime request ${o.overtimeStart}-${o.overtimeEnd} on ${dayIso}.`);
        }
    }
    return warnings;
}

/* ----------------------------------------------------------
 * Helpers (week / quarter)
 * ---------------------------------------------------------- */

function startOfWeek(d) {
    const dt = d instanceof Date ? new Date(d) : new Date(d);
    const day = dt.getDay(); // 0 Sun ... 6 Sat -> treat Monday as start
    const diff = (day === 0 ? 6 : day - 1);
    dt.setDate(dt.getDate() - diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function quarterBounds(d) {
    const dt = d instanceof Date ? new Date(d) : new Date(d);
    const m = dt.getMonth();
    const qStart = Math.floor(m / 3) * 3;
    return {
        start: new Date(dt.getFullYear(), qStart, 1),
        end: new Date(dt.getFullYear(), qStart + 3, 0)
    };
}

module.exports = {
    // time
    timeToMinutes, minutesToTime, durationMinutes, isoDate, addDays, isWeekend, weekday,
    startOfWeek, quarterBounds,
    // leave
    holidaysFor, calcLeaveDays, blackoutHit, checkAdvanceNotice, requiresMedicalCertificate,
    checkLeaveBalance, hasOverlappingLeave, previewTeamCoverage, applyBalanceDelta,
    // shift
    validateRestPeriod, activeComplianceRule,
    // overtime
    calcOvertime, activeOvertimePolicy, checkOvertimeCompliance, checkOvertimeOverlap
};
