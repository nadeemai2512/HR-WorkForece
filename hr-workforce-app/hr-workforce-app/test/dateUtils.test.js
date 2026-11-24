'use strict';
/**
 * Pure unit tests for the date utilities (no DB, run with `mocha` or `cds test`).
 */
const { expect } = require('chai');
const du = require('../srv/lib/dateUtils');

describe('dateUtils', () => {

  describe('workingDaysBetween', () => {
    it('counts Mon-Fri as 5 working days', () => {
      // 2026-11-23 (Mon) → 2026-11-27 (Fri)
      expect(du.workingDaysBetween('2026-11-23', '2026-11-27')).to.equal(5);
    });
    it('excludes weekends', () => {
      // 2026-11-23 (Mon) → 2026-11-29 (Sun) = 5 working days
      expect(du.workingDaysBetween('2026-11-23', '2026-11-29')).to.equal(5);
    });
    it('excludes configured holidays', () => {
      // one holiday on Wed 2026-11-25
      const holidays = [{ holidayDate: '2026-11-25', halfDay: false }];
      expect(du.workingDaysBetween('2026-11-23', '2026-11-27', holidays)).to.equal(4);
    });
    it('counts half-day holidays as 0.5', () => {
      const holidays = [{ holidayDate: '2026-11-25', halfDay: true }];
      expect(du.workingDaysBetween('2026-11-23', '2026-11-27', holidays)).to.equal(4.5);
    });
  });

  describe('calendarDaysBetween', () => {
    it('is inclusive', () => {
      expect(du.calendarDaysBetween('2026-11-23', '2026-11-25')).to.equal(3);
    });
    it('returns 0 when end < start', () => {
      expect(du.calendarDaysBetween('2026-11-25', '2026-11-23')).to.equal(0);
    });
  });

  describe('isWeekend', () => {
    it('flags Saturday and Sunday by default', () => {
      expect(du.isWeekend('2026-11-28')).to.equal(true);  // Sat
      expect(du.isWeekend('2026-11-29')).to.equal(true);  // Sun
      expect(du.isWeekend('2026-11-23')).to.equal(false); // Mon
    });
  });

  describe('minutesBetween (cross-midnight)', () => {
    it('computes normal daytime span', () => {
      expect(du.minutesBetween('09:00', '18:00')).to.equal(9 * 60);
    });
    it('adds 24h when end <= start (night shift)', () => {
      expect(du.minutesBetween('22:00', '06:30')).to.equal(8 * 60 + 30);
    });
  });

  describe('isoWeekKey / quarterKey', () => {
    it('produces ISO week and quarter keys', () => {
      expect(du.isoWeekKey('2026-11-23')).to.match(/^\d{4}-W\d{2}$/);
      expect(du.quarterKey('2026-11-23')).to.equal('2026-Q4');
      expect(du.quarterKey('2026-02-15')).to.equal('2026-Q1');
    });
  });

  describe('restMinutesBetween (cross-midnight shifts)', () => {
    it('detects the 11h violation: Night 22:00-06:30 then Morning 06:00', () => {
      // Night ends 06:30 on day D+1 (crosses midnight). Next morning shift starts 06:00 same day D+1.
      // rest = 06:00 - 06:30 = -30 min => below 11h.
      const rest = du.restMinutesBetween('06:30', '06:00', true);
      expect(rest).to.be.lessThan(11 * 60);
    });
    it('passes when next shift starts after 11h rest', () => {
      const rest = du.restMinutesBetween('18:00', '09:00', false); // ends 18:00 D, next 09:00 D+1
      expect(rest).to.equal(15 * 60);
    });
  });
});
