using { Currency, cuid, managed, temporal } from '@sap/cds/common';

/**
 * WFMS - Workforce Management System
 * Centralized data model for Employee Leave, Shift Scheduling and Overtime Tracking.
 *
 * The model is grouped into five domains:
 *   1. Organization   - Departments, Employees, Skills
 *   2. Leave          - LeaveTypes, LeaveBalances, LeaveRequests, Attachments, Holidays, Blackouts, Policies
 *   3. Shift          - ShiftTemplates, ShiftAssignments, ShiftSwapRequests
 *   4. Overtime       - OvertimeRequests, OvertimePolicies, ComplianceRules, WorkHours, CompOffTransactions
 *   5. Governance     - ApprovalHistory, AuditLogs
 */

namespace wfms;

/* =========================================================
 * 1. ORGANIZATION
 * ========================================================= */

entity Departments : cuid, managed {
    code        : String(20);
    name        : String(120);
    description : String(500);
    country     : String(3);                   // ISO-3166 alpha-3
    region      : String(60);
    headEmployee : Association to Employees;    // department head (set after Employees exist)
    minCoveragePct : Decimal(5,2) default 70;  // minimum staffing threshold for approvals
    active      : Boolean default true;
}

entity Employees : cuid, managed {
    employeeNumber : String(10);
    firstName      : String(80);
    lastName       : String(80);
    fullName       : String(160);              // convenience display name
    email          : String(160);
    phone          : String(40);
    department     : Association to Departments @mandatory;
    manager        : Association to Employees;     // self-reference, direct reporting line
    status         : String(20) default 'Active'; // Active | Inactive | OnLeave | Terminated
    employeeCategory : String(30) default 'Permanent'; // Permanent | Contract | Intern
    hireDate       : Date;
    country        : String(3);
    region         : String(60);
    hourlyBaseRate : Decimal(10,2);            // used for overtime amount calculation
    skills         : Association to many EmployeeSkills on skills.employee = $self;
    leaveBalances  : Association to many LeaveBalances  on leaveBalances.employee = $self;
    shiftAssignments : Association to many ShiftAssignments on shiftAssignments.employee = $self;
    workHours      : Association to many EmployeeWorkHours on workHours.employee = $self;
}

entity EmployeeSkills : cuid, managed {
    employee     : Association to Employees @mandatory;
    skill        : String(80);
    proficiency  : String(20) default 'Intermediate'; // Beginner | Intermediate | Advanced | Expert
    primarySkill : Boolean default false;
}

/* =========================================================
 * 2. LEAVE
 * ========================================================= */

entity LeaveTypes : cuid, managed {
    code                       : String(10);   // EL | SL | CL | CO
    name                       : String(60);
    description                : String(500);
    defaultEntitlementDays     : Decimal(5,1) default 0;
    allowNegativeBalance       : Boolean default false;
    requireCertificateAfterDays: Integer default 0;   // 0 = never; SL example = 2
    exemptFromBlackout         : Boolean default false; // Sick Leave = true
    exemptFromAdvanceNotice    : Boolean default false; // Sick Leave = true
    eligibleForCarryForward    : Boolean default false;
    maxCarryForwardDays        : Decimal(5,1) default 0;
    active                     : Boolean default true;
    balances                   : Association to many LeaveBalances on balances.leaveType = $self;
    requests                   : Association to many LeaveRequests  on requests.leaveType  = $self;
}

entity LeaveBalances : cuid, managed {
    employee     : Association to Employees  @mandatory;
    leaveType    : Association to LeaveTypes @mandatory;
    year         : Integer;                    // e.g. 2026
    entitlement  : Decimal(6,1) default 0;     // total granted for the year
    carryForward : Decimal(6,1) default 0;     // brought from prior year
    used         : Decimal(6,1) default 0;     // approved leave days
    pending      : Decimal(6,1) default 0;     // submitted not yet approved
    // available = entitlement + carryForward - used - pending
    // Kept as a persisted snapshot, recomputed in handlers on approval/cancel.
    available    : Decimal(6,1) default 0;
    adjustments  : Association to many LeaveBalanceAdjustments on adjustments.balance = $self;
}

entity LeaveBalanceAdjustments : cuid, managed {
    balance      : Association to LeaveBalances @mandatory;
    delta        : Decimal(6,1);                // +entitlement, -correction
    reason       : String(500);
    adjustedBy   : String(160);
    adjustedAt   : DateTime @cds.on.insert : $now;
    previousEntitlement : Decimal(6,1);
    newEntitlement      : Decimal(6,1);
}

entity LeaveRequests : cuid, managed {
    employee     : Association to Employees  @mandatory;
    leaveType    : Association to LeaveTypes @mandatory;
    startDate    : Date   @mandatory;
    endDate      : Date   @mandatory;
    days         : Decimal(6,1);               // computed working days (excl. weekends + holidays)
    isHalfDay    : Boolean default false;
    reason       : String(500);
    status       : String(30) default 'Draft';  // Draft | Submitted | PendingManager | Approved | Rejected | SentBack | Cancelled
    approver     : Association to Employees;
    approvedAt   : DateTime;
    approverComments : String(500);
    requestorComments : String(500);
    coverageOverrideApplied : Boolean default false;
    coverageOverrideReason  : String(500);
    blackoutExempt         : Boolean default false;
    attachments            : Association to many LeaveAttachments on attachments.leaveRequest = $self;
    approvalHistory        : Association to many ApprovalHistory on approvalHistory.entityID = $self.ID and approvalHistory.entityType = 'LeaveRequest';
}

entity LeaveAttachments : cuid, managed {
    leaveRequest : Association to LeaveRequests @mandatory;
    fileName     : String(200);
    mimeType     : String(100);
    content      : LargeBinary;
    uploadedBy   : String(160);
    uploadedAt   : DateTime @cds.on.insert : $now;
}

entity CompanyHolidays : cuid, managed {
    name         : String(120);
    holidayDate  : Date   @mandatory;
    country      : String(3);
    region       : String(60);                 // null = nationwide
    holidayType  : String(30) default 'Public'; // Public | Company | Regional
    isWorkingDay : Boolean default false;      // whether the holiday counts as a working day for OT multiplier
}

entity BlackoutPeriods : cuid, managed {
    name         : String(120);
    startDate    : Date   @mandatory;
    endDate      : Date   @mandatory;
    country      : String(3);
    region       : String(60);
    appliesToLeaveTypes : String(200);         // comma-separated LeaveType codes (EL,CL) - empty = all non-exempt
    reason       : String(500);
    active       : Boolean default true;
}

entity LeavePolicies : cuid, managed {
    leaveType                  : Association to LeaveTypes @mandatory;
    country                    : String(3);
    region                     : String(60);
    minAdvanceNoticeDays       : Integer default 0;        // minimum advance notice in calendar days
    advanceNoticeThresholdDays : Integer default 0;        // only requests longer than this require notice
    requireCertificateAfterDays: Integer default 0;        // mirrors leave type, can override per region
    effectiveFrom              : Date;
    effectiveTo                : Date;
    active                     : Boolean default true;
}

/* =========================================================
 * 3. SHIFT
 * ========================================================= */

entity ShiftTemplates : cuid, managed {
    code        : String(20);                  // MOR | GEN | NGT
    name        : String(60);
    description : String(500);
    startTime   : String(5);                   // "06:00" - kept as String for clean cross-day handling
    endTime     : String(5);                   // "14:30"
    breakMinutes: Integer default 30;
    color       : String(7) default '#3a8dd1'; // hex for PlanningCalendar
    active      : Boolean default true;
    assignments : Association to many ShiftAssignments on assignments.shiftTemplate = $self;
}

entity ShiftAssignments : cuid, managed {
    employee      : Association to Employees      @mandatory;
    shiftTemplate : Association to ShiftTemplates @mandatory;
    assignmentDate: Date   @mandatory;
    startTime     : String(5);                   // materialized for fast rest-period validation
    endTime       : String(5);
    status        : String(20) default 'Planned'; // Planned | Confirmed | Completed | Cancelled
    notes         : String(500);
    swapRequest   : Association to ShiftSwapRequests;
    restViolation : Boolean default false;       // computed on assignment
}

entity ShiftSwapRequests : cuid, managed {
    requestor         : Association to Employees      @mandatory;
    requestorShift    : Association to ShiftAssignments @mandatory;
    targetEmployee    : Association to Employees      @mandatory;
    targetShift       : Association to ShiftAssignments;
    status            : String(30) default 'Submitted'; // Submitted | PendingPeer | PendingManager | Approved | Rejected | Cancelled
    reason            : String(500);
    peerDecision      : String(20);                   // Accepted | Rejected | (null)
    peerDecisionAt    : DateTime;
    peerComments      : String(500);
    managerDecision   : String(20);
    managerDecisionAt : DateTime;
    managerComments   : String(500);
    eligibilityNotes  : String(500);
}

/* =========================================================
 * 4. OVERTIME & COMPLIANCE
 * ========================================================= */

entity ComplianceRules : cuid, managed {
    country              : String(3);
    region               : String(60);
    employeeCategory     : String(30) default 'Permanent';
    dailyMaxHours        : Decimal(4,1) default 12;    // regular + OT per day
    weeklyRegularHours   : Decimal(4,1) default 48;
    weeklyMaxOvertime    : Decimal(4,1) default 12;
    weeklyMaxTotalHours  : Decimal(4,1) default 60;
    quarterlyOvertimeLimit : Decimal(5,1) default 50;
    minRestHours         : Decimal(3,1) default 11;    // between consecutive shifts
    warningThresholdPct  : Decimal(4,1) default 80;   // compliance warning at 80% of quarterly limit
    effectiveFrom        : Date;
    effectiveTo          : Date;
    active               : Boolean default true;
}

entity OvertimePolicies : cuid, managed {
    country                : String(3);
    region                 : String(60);
    weekdayMultiplier      : Decimal(3,2) default 1.50;
    weekendMultiplier      : Decimal(3,2) default 2.00;
    publicHolidayMultiplier: Decimal(3,2) default 2.50;
    compOffConversionHours : Decimal(4,1) default 0;  // OT hours per 1 Comp-Off credit; 0 = disabled
    effectiveFrom          : Date;
    effectiveTo            : Date;
    active                 : Boolean default true;
}

entity OvertimeRequests : cuid, managed {
    employee          : Association to Employees @mandatory;
    workDate          : Date   @mandatory;
    regularShiftStart : String(5);
    regularShiftEnd   : String(5);
    regularShiftMinutes : Integer;
    overtimeStart     : String(5) @mandatory;
    overtimeEnd       : String(5) @mandatory;
    overtimeMinutes   : Integer;                   // computed
    overtimeType      : String(20);                // Weekday | Weekend | PublicHoliday - computed
    reason            : String(500);
    status            : String(30) default 'Draft'; // Draft | Submitted | PendingManager | Approved | Rejected | SentBack | Cancelled
    approver          : Association to Employees;
    approvedAt        : DateTime;
    approverComments  : String(500);
    requestorComments : String(500);
    baseHourlyRate    : Decimal(10,2);             // materialized from employee for audit
    multiplier        : Decimal(3,2);
    estimatedAmount   : Decimal(12,2);
    compOffElection   : String(20) default 'Payout'; // Payout | CompOff | Split
    compOffCreditsEarned : Decimal(5,1) default 0;
    overlapWarning    : String(500);
    complianceWarning : String(500);
    attachment        : LargeBinary;
    attachmentName    : String(200);
}

entity EmployeeWorkHours : cuid, managed {
    employee         : Association to Employees @mandatory;
    workDate         : Date   @mandatory;
    regularMinutes   : Integer default 0;
    overtimeMinutes  : Integer default 0;
    totalMinutes     : Integer default 0;       // computed: regular + overtime
    source           : String(20) default 'Estimated'; // Estimated | Approved | Timesheet
    overtimeRequest  : Association to OvertimeRequests;
}

entity CompOffTransactions : cuid, managed {
    employee        : Association to Employees       @mandatory;
    sourceOvertime  : Association to OvertimeRequests;
    type            : String(10);                    // Earned | Used | Expired
    hoursEarned     : Decimal(6,1) default 0;
    hoursUsed       : Decimal(6,1) default 0;
    balance         : Decimal(6,1) default 0;        // running balance after this txn
    earnedAt        : DateTime;
    usedAt          : DateTime;
    expiresAt       : Date;
    comments        : String(500);
}

/* =========================================================
 * 5. GOVERNANCE
 * ========================================================= */

entity ApprovalHistory : cuid {
    entityType : String(30);   // LeaveRequest | OvertimeRequest | ShiftSwap
    entityID   : UUID;
    approver   : String(160);
    action     : String(30);    // Submitted | Approved | Rejected | SentBack | Cancelled | PeerAccepted | PeerRejected
    decision   : String(30);
    comments   : String(500);
    decidedAt  : DateTime @cds.on.insert : $now;
}

entity AuditLogs : cuid {
    userId        : String(160);
    action        : String(60);    // e.g. LeaveSubmit, LeaveApprove, CoverageOverride, PolicyChange
    entityType    : String(40);
    entityID      : String(64);
    previousValue : String(2000);
    newValue      : String(2000);
    timestamp     : DateTime @cds.on.insert : $now;
    comments      : String(1000);
}
