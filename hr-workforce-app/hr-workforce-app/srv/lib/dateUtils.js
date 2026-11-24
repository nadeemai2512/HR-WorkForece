'use strict';
/**
 * dateUtils.js — pure date helpers used across leave / overtime / shift logic.
 * No DB access, fully unit-testable.
 */

/** Parse 'YYYY-MM-DD' or a Date into a local Date at midnight (no TZ drift). */
function toDate(value) {
    if (value instanceof Date) {
        const d = new Date(value.getFullYear(), value.getMonth(), value.getDate());
        return d;
    }
    if (typeof value === 'string') {
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }
    throw new Error(`Cannot parse date: ${value}`);
}

function toDateString(d) {
    if (!(d instanceof Date)) d = toDate(d);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Add n calendar days. */
function addDays(value, n) {
    const d = toDate(value);
    d.setDate(d.getDate() + n);
    return d;
}

/** 0 = Sunday ... 6 = Saturday */
function dayOfWeek(value) {
    return toDate(value).getDay();
}

/** Default weekend = Saturday + Sunday. Pass weekendDays to override. */
function isWeekend(value, weekendDays = [0, 6]) {
    return weekendDays.includes(dayOfWeek(value));
}

/** Inclusive date range iterator (yield Date objects). */
function* eachDay(start, end) {
    let s = toDate(start);
    const e = toDate(end);
    while (s.getTime() <= e.getTime()) {
        yield new Date(s);
        s = addDays(s, 1);
    }
}

/**
 * Count working days between two dates (inclusive), excluding weekends and the
 * provided set of holiday date strings ('YYYY-MM-DD'). Half-day holidays are
 * counted as 0.5.
 */
function workingDaysBetween(start, end, holidays = [], weekendDays = [0, 6]) {
    const holidaySet = new Map();
    for (const h of holidays) {
        if (h && typeof h === 'object' && h.holidayDate) {
            holidaySet.set(toDateString(h.holidayDate), h.halfDay ? 0.5 : 1);
        } else if (typeof h === 'string') {
            holidaySet.set(h, 1);
        }
    }
    let total = 0;
    for (const d of eachDay(start, end)) {
        if (isWeekend(d, weekendDays)) continue;
        const key = toDateString(d);
        if (holidaySet.has(key)) {
            total += holidaySet.get(key) === 0.5 ? 0.5 : 0;
            continue;
        }
        total += 1;
    }
    return total;
}

/** Calendar days between two dates inclusive. */
function calendarDaysBetween(start, end) {
    const s = toDate(start).getTime();
    const e = toDate(end).getTime();
    if (e < s) return 0;
    return Math.floor((e - s) / 86400000) + 1;
}

/** 'YYYY-Www' ISO week key. */
function isoWeekKey(value) {
    const d = toDate(value);
    // copy date so we can mutate
    const t = new Date(d.valueOf());
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // Thursday of this week
    const week1 = new Date(t.getFullYear(), 0, 4);
    const week = 1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${t.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 'YYYY-Qn' quarter key. */
function quarterKey(value) {
    const d = toDate(value);
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/** Convert 'HH:mm' to minutes since midnight. */
function hhmmToMinutes(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/**
 * Minutes between a start and end expressed as 'HH:mm'. When the end is on or
 * before the start we assume the shift crosses midnight (e.g. Night 22:00-06:30).
 */
function minutesBetween(start, end) {
    const s = hhmmToMinutes(start);
    let e = hhmmToMinutes(end);
    if (e <= s) e += 24 * 60; // crosses midnight
    return e - s;
}

/** Rest minutes between an end ('HH:mm' on day D) and a next start ('HH:mm' on day D+1 or same). */
function restMinutesBetween(prevEnd, nextStart, prevCrossesMidnight = false) {
    let prevEndMin = hhmmToMinutes(prevEnd);
    let nextStartMin = hhmmToMinutes(nextStart);
    // Normalise: previous shift ends at prevEndMin measured from its own start-of-day.
    // If it crossed midnight, its end is effectively next-day morning; convert to an
    // absolute timeline anchored at 00:00 of the previous shift's start day.
    if (prevCrossesMidnight) prevEndMin += 24 * 60; // e.g. 06:30 -> day+1 06:30 = 30:30
    // Next shift starts at nextStartMin on the following calendar day relative to prev start.
    const nextAbsolute = nextStartMin + 24 * 60;
    return nextAbsolute - prevEndMin;
}

module.exports = {
    toDate, toDateString, addDays, dayOfWeek, isWeekend, eachDay,
    workingDaysBetween, calendarDaysBetween, isoWeekKey, quarterKey,
    hhmmToMinutes, minutesBetween, restMinutesBetween,
};
