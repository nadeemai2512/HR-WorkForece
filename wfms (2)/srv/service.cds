using wfms from '../db/schema';

/**
 * WFMS Main OData V4 service.
 *
 * Exposes all 20 persistent entities plus read-only dashboard projections
 * (LeaveBalanceView, OvertimeSummary, WeeklyHoursView, ComplianceAlerts,
 * EmployeeKPIs, ManagerKPIs) that are computed in handlers from the
 * underlying transactional entities. Every dashboard KPI is bound to one of
 * these projections, never to hardcoded values.
 *
 * Handlers live in srv/WorkforceService.js which requires:
 *   lib/calculations.js   - pure validation functions (leave days, rest period, OT, limits)
 *   lib/policy.js         - active policy/compliance rule resolution
 *   leave-service.js      - leave request lifecycle + coverage validation
 *   shift-service.js      - shift swap workflow + rest period enforcement
 *   overtime-service.js   - overtime lifecycle + compliance + amount calc
 *   hr-service.js         - balance adjustments, payroll export
 *   audit-service.js      - audit log + dashboard projection reads
 */
service WorkforceService @(path: 'workforce', requires: 'authenticated-user') {

    /* ---- Organization ---- */
    @cds.redirection.target
    entity Departments     as projection on wfms.Departments;
    @cds.redirection.target
    entity Employees       as projection on wfms.Employees;
    entity EmployeeSkills  as projection on wfms.EmployeeSkills;

    /* ---- Leave ---- */
    entity LeaveTypes              as projection on wfms.LeaveTypes;
    @cds.redirection.target
    entity LeaveBalances           as projection on wfms.LeaveBalances;
    entity LeaveBalanceAdjustments as projection on wfms.LeaveBalanceAdjustments;
    entity LeaveRequests           as projection on wfms.LeaveRequests;
    entity LeaveAttachments        as projection on wfms.LeaveAttachments;
    entity CompanyHolidays         as projection on wfms.CompanyHolidays;
    entity BlackoutPeriods         as projection on wfms.BlackoutPeriods;
    entity LeavePolicies           as projection on wfms.LeavePolicies;

    /* ---- Shift ---- */
    entity ShiftTemplates    as projection on wfms.ShiftTemplates;
    entity ShiftAssignments  as projection on wfms.ShiftAssignments;
    entity ShiftSwapRequests as projection on wfms.ShiftSwapRequests;

    /* ---- Overtime & compliance ---- */
    entity ComplianceRules     as projection on wfms.ComplianceRules;
    entity OvertimePolicies    as projection on wfms.OvertimePolicies;
    @cds.redirection.target
    entity OvertimeRequests    as projection on wfms.OvertimeRequests;
    @cds.redirection.target
    entity EmployeeWorkHours   as projection on wfms.EmployeeWorkHours;
    entity CompOffTransactions as projection on wfms.CompOffTransactions;

    /* ---- Governance ---- */
    entity ApprovalHistory as projection on wfms.ApprovalHistory;
    entity AuditLogs       as projection on wfms.AuditLogs;

    /* =========================================================
     * Read-only dashboard projections (computed in handlers)
     * ========================================================= */

    /** One row per balance with joined employee / department / leave-type names. */
    entity LeaveBalanceView as
        select from wfms.LeaveBalances {
            key ID,
            employee.employeeNumber as employeeNumber,
            employee.fullName       as employeeName,
            employee.ID              as employee_ID,
            employee.department.name as departmentName,
            leaveType.code           as leaveTypeCode,
            leaveType.name           as leaveTypeName,
            year,
            entitlement,
            carryForward,
            used,
            pending,
            available
        };

    /** Weekly working-hours chart feed (joined with employee name). */
    entity WeeklyHoursView as
        select from wfms.EmployeeWorkHours {
            key ID,
            employee.employeeNumber as employeeNumber,
            employee.fullName       as fullName,
            workDate,
            regularMinutes,
            overtimeMinutes,
            totalMinutes,
            source
        };

    /** Overtime detail rows joined with employee + department for reporting. */
    entity OvertimeSummary as
        select from wfms.OvertimeRequests {
            key ID,
            employee.employeeNumber       as employeeNumber,
            employee.fullName             as employeeName,
            employee.department.name      as departmentName,
            workDate,
            overtimeMinutes,
            overtimeType,
            multiplier,
            estimatedAmount,
            status,
            compOffElection,
            compOffCreditsEarned,
            complianceWarning,
            overlapWarning
        };

    /** Employee dashboard KPIs - virtual fields filled in after-READ. */
    entity EmployeeKPIs as projection on wfms.Employees {
        *,
        virtual availableEL : Decimal(6,1),
        virtual availableSL : Decimal(6,1),
        virtual availableCL : Decimal(6,1),
        virtual availableCO : Decimal(6,1),
        virtual pendingLeave   : Integer,
        virtual approvedLeave  : Integer,
        virtual weeklyMinutes  : Integer,
        virtual remainingWeeklyMinutes : Integer,
        virtual pendingOvertime : Integer,
        virtual approvedOvertimeMinutes : Integer
    } excluding { hourlyBaseRate, phone, skills, leaveBalances, shiftAssignments, workHours };

    /** Manager team dashboard KPIs. */
    entity ManagerKPIs as projection on wfms.Employees {
        *,
        virtual teamMembers         : Integer,
        virtual presentToday        : Integer,
        virtual onLeaveToday        : Integer,
        virtual pendingLeaveApprovals  : Integer,
        virtual pendingOvertimeApprovals: Integer,
        virtual pendingSwapRequests    : Integer,
        virtual staffingPct            : Decimal(5,2),
        virtual complianceAlerts       : Integer
    } excluding { hourlyBaseRate, phone, email, skills, leaveBalances, shiftAssignments, workHours };

    /** Compliance alerts surfaced to Employee / Manager / HR dashboards. */
    entity ComplianceAlerts as projection on wfms.Employees {
        *,
        virtual alertType    : String(40),
        virtual severity     : String(20),
        virtual message      : String(500),
        virtual asOfDate     : Date
    } excluding { hourlyBaseRate, phone, email, hireDate, skills, leaveBalances, shiftAssignments, workHours };

    /* =========================================================
     * Actions - all workflow transitions execute server-side only.
     * The status field is never written directly by the UI; the UI
     * calls these actions, which re-validate policy and then mutate
     * status inside a database transaction.
     * ========================================================= */

    // Leave request lifecycle
    action submitLeaveRequest      (ID : UUID);
    action approveLeaveRequest     (ID : UUID, comments : String, coverageOverride : Boolean, coverageOverrideReason : String);
    action rejectLeaveRequest      (ID : UUID, comments : String);
    action sendBackLeaveRequest    (ID : UUID, comments : String);
    action cancelLeaveRequest      (ID : UUID);

    // Shift swap lifecycle
    action submitShiftSwap         (ID : UUID);
    action peerAcceptSwap          (ID : UUID, comments : String);
    action peerRejectSwap          (ID : UUID, comments : String);
    action approveShiftSwap        (ID : UUID, comments : String);
    action rejectShiftSwap         (ID : UUID, comments : String);

    // Overtime lifecycle
    action submitOvertime          (ID : UUID);
    action approveOvertime         (ID : UUID, comments : String);
    action rejectOvertime          (ID : UUID, comments : String);
    action sendBackOvertime        (ID : UUID, comments : String);
    action cancelOvertime          (ID : UUID);

    // HR actions
    action adjustLeaveBalance      (ID : UUID, delta : Decimal(6,1), reason : String);
    action exportPayrollOvertime   (fromDate : Date, toDate : Date) returns String;

    // Reusable calculation entry points - exposed for tests and the UI preview
    function calcLeaveDays        (employee_ID : UUID, leaveType_ID : UUID, startDate : Date, endDate : Date, isHalfDay : Boolean) returns Decimal(6,1);
    function validateRestPeriod   (employee_ID : UUID, date : Date, startTime : String, endTime : String) returns String;
    function calcOvertime         (employee_ID : UUID, workDate : Date, otStart : String, otEnd : String) returns String;
    function previewTeamCoverage  (leaveRequest_ID : UUID) returns Decimal(5,2);
}
