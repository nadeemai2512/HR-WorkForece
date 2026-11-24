'use strict';
/**
 * Integration tests for HRService business logic, bootstrapped in-memory with
 * @cap-js/sqlite and the mock users defined in .cdsrc.json [test].
 *
 * Run with:  cds test   (or)   npx mocha test/business.test.js --timeout 30000
 *
 * The cds.test client is axios-based: GET/POST are axios methods, auth is passed
 * via { auth: { username, password } } and responses use .status / .data.
 */
const { expect } = require('chai');
const cds = require('@sap/cds');

const AUTH = (u) => ({ auth: { username: u, password: u } });

describe('HR Workforce Service', () => {
  const app = cds.test();
  const { GET, POST } = app;

  before(async () => { await app; });
  after(async () => { await cds.shutdown(); });

  /* ---- 1. Role-based & instance-based READ authorization ---- */
  describe('authorization', () => {
    it('HR admin sees all employees', async () => {
      const r = await GET('/odata/v4/hr/Employees?$count=true', AUTH('alice'));
      expect(r.status).to.equal(200);
      expect(r.data['@odata.count']).to.equal(6);
    });
    it('employee sees only self', async () => {
      const r = await GET('/odata/v4/hr/Employees', AUTH('carol'));
      expect(r.status).to.equal(200);
      expect(r.data.value.length).to.equal(1);
      expect(r.data.value[0].employeeNo).to.equal('E1003');
    });
    it('manager sees self + direct reports', async () => {
      const r = await GET('/odata/v4/hr/Employees', AUTH('bob'));
      expect(r.status).to.equal(200);
      const nos = r.data.value.map(e => e.employeeNo).sort();
      expect(nos).to.deep.equal(['E1002', 'E1003', 'E1004', 'E1005']);
    });
    it('employee cannot read another employee via OData filter (backend enforces)', async () => {
      const r = await GET("/odata/v4/hr/Employees?$filter=employeeNo eq 'E1004'", AUTH('carol'));
      expect(r.status).to.equal(200);
      expect(r.data.value.length).to.equal(0);
    });
  });

  /* ---- 2. Leave calculation function import ---- */
  describe('calculateLeaveDays function', () => {
    it('returns 5 working days for a clean future Mon-Fri week', async () => {
      const r = await GET(
        "/odata/v4/hr/calculateLeaveDays(employeeNo='E1003',leaveTypeCode='EL',startDate=2026-12-07,endDate=2026-12-11)",
        AUTH('carol'));
      expect(r.status).to.equal(200);
      expect(r.data.workingDays).to.equal(5);
      expect(r.data.isBlocked).to.equal(false);
    });

    it('blocks Earned Leave during a configured blackout period', async () => {
      const r = await GET(
        "/odata/v4/hr/calculateLeaveDays(employeeNo='E1003',leaveTypeCode='EL',startDate=2026-12-22,endDate=2026-12-24)",
        AUTH('carol'));
      expect(r.data.isBlocked).to.equal(true);
      expect(r.data.messages).to.match(/blackout/i);
    });

    it('requires a medical certificate for Sick Leave > 2 consecutive calendar days', async () => {
      const r = await GET(
        "/odata/v4/hr/calculateLeaveDays(employeeNo='E1003',leaveTypeCode='SL',startDate=2027-02-01,endDate=2027-02-05)",
        AUTH('carol'));
      expect(r.data.medicalCertRequired).to.equal(true);
    });

    it('blocks leave exceeding available balance (no negative balance for EL)', async () => {
      const r = await GET(
        "/odata/v4/hr/calculateLeaveDays(employeeNo='E1005',leaveTypeCode='EL',startDate=2027-03-01,endDate=2027-03-07)",
        AUTH('eve'));
      expect(r.data.isBlocked).to.equal(true);
      expect(r.data.messages).to.match(/insufficient balance/i);
    });

    it('enforces minimum advance notice for long leave', async () => {
      const r = await GET(
        "/odata/v4/hr/calculateLeaveDays(employeeNo='E1003',leaveTypeCode='EL',startDate=2026-11-24,endDate=2026-11-29)",
        AUTH('carol'));
      expect(r.data.isBlocked).to.equal(true);
      expect(r.data.messages).to.match(/advance/i);
    });
  });

  /* ---- 3. Leave submit -> approve workflow + balance + audit ---- */
  describe('leave workflow', () => {
    let leaveId, days;
    it('creates a draft leave request (backend fills days)', async () => {
      const r = await POST('/odata/v4/hr/LeaveRequests', {
        employeeNo: 'E1003', employee_ID: 'E1003', leaveType_code: 'EL',
        startDate: '2027-01-18', endDate: '2027-01-22', reason: 'Integration test vacation'
      }, AUTH('carol'));
      expect(r.status).to.be.oneOf([200, 201]);
      leaveId = r.data.ID;
      days = Number(r.data.days);
      expect(days).to.be.greaterThan(0);
    });

    it('submit moves to PENDING_MANAGER and reserves pending balance', async () => {
      const before = await GET("/odata/v4/hr/LeaveBalances?$filter=employee_ID eq 'E1003' and leaveType_code eq 'EL'", AUTH('carol'));
      const pendingBefore = Number(before.data.value[0].pending);

      const r = await POST(`/odata/v4/hr/LeaveRequests(ID=${wrap(leaveId)})/submit`, {}, AUTH('carol'));
      expect(r.status).to.equal(200);
      const status = r.data.value ? r.data.value.status : r.data.status;
      expect(status).to.equal('PENDING_MANAGER');

      const after = await GET("/odata/v4/hr/LeaveBalances?$filter=employee_ID eq 'E1003' and leaveType_code eq 'EL'", AUTH('carol'));
      expect(Number(after.data.value[0].pending)).to.equal(pendingBefore + days);
    });

    it('manager approves -> balance used increases + audit log written', async () => {
      const r = await POST(`/odata/v4/hr/LeaveRequests(ID=${wrap(leaveId)})/approve(comment='Approved')`, {}, AUTH('bob'));
      expect(r.status).to.equal(200);
      const status = r.data.value ? r.data.value.status : r.data.status;
      expect(status).to.equal('APPROVED');

      const bal = await GET("/odata/v4/hr/LeaveBalances?$filter=employee_ID eq 'E1003' and leaveType_code eq 'EL'", AUTH('bob'));
      expect(Number(bal.data.value[0].used)).to.be.greaterThan(5); // started at 5

      const audit = await GET("/odata/v4/hr/AuditLogs?$filter=action eq 'LEAVE_APPROVED'", AUTH('alice'));
      expect(audit.data.value.some(a => a.entityId === leaveId)).to.equal(true);
    });
  });

  /* ---- 4. Overtime submit -> approve + work hours + comp-off ---- */
  describe('overtime workflow', () => {
    let otId;
    it('creates + submits overtime (backend computes multiplier/amount)', async () => {
      const r = await POST('/odata/v4/hr/OvertimeRequests', {
        employeeNo: 'E1003', employee_ID: 'E1003', workDate: '2027-02-15',
        otStart: '19:00', otEnd: '21:00', regularShiftHours: 8, convertToCompOff: true,
        reason: 'Production deployment'
      }, AUTH('carol'));
      expect(r.status).to.be.oneOf([200, 201]);
      otId = r.data.ID;
      expect(Number(r.data.otHours)).to.equal(2);
      expect(Number(r.data.multiplier)).to.equal(1.5); // weekday

      const s = await POST(`/odata/v4/hr/OvertimeRequests(ID=${wrap(otId)})/submit`, {}, AUTH('carol'));
      expect(s.status).to.equal(200);
    });

    it('manager approval writes work hours + comp-off credits', async () => {
      const r = await POST(`/odata/v4/hr/OvertimeRequests(ID=${wrap(otId)})/approve(comment='ok')`, {}, AUTH('bob'));
      expect(r.status).to.equal(200);

      const wh = await GET("/odata/v4/hr/EmployeeWorkHours?$filter=employee_ID eq 'E1003' and workDate eq 2027-02-15", AUTH('bob'));
      expect(wh.data.value.length).to.equal(1);
      expect(Number(wh.data.value[0].otMinutes)).to.equal(120);

      const comp = await GET("/odata/v4/hr/CompOffTransactions?$filter=sourceRequest_ID eq " + wrap(otId), AUTH('alice'));
      expect(comp.data.value.length).to.equal(1);
      expect(Number(comp.data.value[0].creditsEarned)).to.equal(2);
    });
  });

  /* ---- 5. Shift rest-period enforcement ---- */
  describe('shift rest period', () => {
    it('rejects an assignment that violates the 11h rest rule', async () => {
      // Carol has GENERAL 09:00-18:00 on 2026-11-26 and 2026-11-27 (seed).
      // Adding NIGHT 22:00-06:30 on 2026-11-26 -> ends 06:30 on 11-27, only 2.5h before the 09:00 GENERAL.
      let err;
      try {
        await POST('/odata/v4/hr/ShiftAssignments', {
          employeeNo: 'E1003', employee_ID: 'E1003', template_code: 'NIGHT',
          shiftDate: '2026-11-26', startTime: '22:00', endTime: '06:30', crossesMidnight: true
        }, AUTH('bob'));
      } catch (e) { err = e; }
      expect(err).to.exist;
      expect(err.response ? err.response.status : err.status).to.equal(400);
    });
  });

  /* ---- 6. Shift swap full workflow ---- */
  describe('shift swap workflow', () => {
    let swapId, assignmentId;
    it('creates a swap request targeting an eligible colleague', async () => {
      const asg = await GET("/odata/v4/hr/ShiftAssignments?$filter=employee_ID eq 'E1003' and shiftDate eq 2026-11-26", AUTH('carol'));
      assignmentId = asg.data.value[0].ID;

      const r = await POST('/odata/v4/hr/ShiftSwapRequests', {
        requestor_ID: 'E1003', targetEmployee_ID: 'E1005', assignment_ID: assignmentId,
        reason: 'Personal commitment'
      }, AUTH('carol'));
      expect(r.status).to.be.oneOf([200, 201]);
      swapId = r.data.ID;
    });

    it('submit -> PENDING_PEER', async () => {
      const r = await POST(`/odata/v4/hr/ShiftSwapRequests(ID=${wrap(swapId)})/submit`, {}, AUTH('carol'));
      const status = r.data.value ? r.data.value.status : r.data.status;
      expect(status).to.equal('PENDING_PEER');
    });

    it('target peer accepts -> PENDING_MANAGER', async () => {
      const r = await POST(`/odata/v4/hr/ShiftSwapRequests(ID=${wrap(swapId)})/peerAccept(comment='ok')`, {}, AUTH('eve'));
      const status = r.data.value ? r.data.value.status : r.data.status;
      expect(status).to.equal('PENDING_MANAGER');
    });

    it('manager approves -> assignment reassigned to target', async () => {
      const r = await POST(`/odata/v4/hr/ShiftSwapRequests(ID=${wrap(swapId)})/approve(comment='approved')`, {}, AUTH('bob'));
      const status = r.data.value ? r.data.value.status : r.data.status;
      expect(status).to.equal('APPROVED');

      const asg = await GET(`/odata/v4/hr/ShiftAssignments(${wrap(assignmentId)})`, AUTH('bob'));
      expect(asg.data.employeeNo).to.equal('E1005');
      expect(asg.data.status).to.equal('SWAPPED');
    });
  });
});

/** Wrap a UUID/string key value in single quotes for OData URL key segments. */
function wrap(v) { return "'" + v + "'"; }
