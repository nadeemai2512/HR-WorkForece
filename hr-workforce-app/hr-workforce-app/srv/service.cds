using my.hr from '../db/schema';

/**
 * OData V4 service: HRService
 * Every projection mirrors the canonical entity; UI bindings target these names.
 */
service HRService @(path: '/odata/v4/hr') {

    /* ---- Master data ---- */
    entity Departments    as projection on hr.Departments;
    entity Employees      as projection on hr.Employees;
    entity EmployeeSkills as projection on hr.EmployeeSkills;
    entity LeaveTypes     as projection on hr.LeaveTypes;
    entity LeavePolicies  as projection on hr.LeavePolicies;
    entity LeaveBalances  as projection on hr.LeaveBalances;
    entity CompanyHolidays as projection on hr.CompanyHolidays;
    entity BlackoutPeriods as projection on hr.BlackoutPeriods;
    entity ShiftTemplates  as projection on hr.ShiftTemplates;
    entity ShiftAssignments as projection on hr.ShiftAssignments;
    entity OvertimePolicies as projection on hr.OvertimePolicies;
    entity ComplianceRules as projection on hr.ComplianceRules;
    entity EmployeeWorkHours as projection on hr.EmployeeWorkHours;
    entity CompOffTransactions as projection on hr.CompOffTransactions;
    entity AuditLogs       as projection on hr.AuditLogs;

    /* ---- Transactional entities (compositions expanded) ---- */
    entity LeaveRequests as projection on hr.LeaveRequests {
        * , employee as Employee, leaveType as LeaveType,
          attachments as LeaveAttachments, approvals as ApprovalHistory
    } actions {
        action submit() returns LeaveRequests;                 // DRAFT/SUBMITTED -> PENDING_MANAGER
        action cancel() returns LeaveRequests;
        action approve(comment : String) returns LeaveRequests;   // manager approve + balance deduction
        action rejectRequest(comment : String) returns LeaveRequests;
        action sendBack(comment : String) returns LeaveRequests;
        action applyCoverageOverride(reason : String) returns LeaveRequests;
        action recalcDays() returns LeaveRequests;
    };

    entity LeaveAttachments as projection on hr.LeaveAttachments;

    entity OvertimeRequests as projection on hr.OvertimeRequests {
        * , employee as Employee,
          approvals as ApprovalHistory
    } actions {
        action submit() returns OvertimeRequests;
        action cancel() returns OvertimeRequests;
        action approve(comment : String) returns OvertimeRequests;  // writes work hours + comp-off
        action rejectRequest(comment : String) returns OvertimeRequests;
        action sendBack(comment : String) returns OvertimeRequests;
        action recalc() returns OvertimeRequests;                  // recompute minutes/multiplier/amount
    };

    entity ShiftSwapRequests as projection on hr.ShiftSwapRequests {
        * , requestor as Employee, targetEmployee,
          assignment as ShiftAssignments,
          approvals as ApprovalHistory
    } actions {
        action submit() returns ShiftSwapRequests;        // SUBMITTED -> PENDING_PEER
        action peerAccept(comment : String) returns ShiftSwapRequests;  // -> PENDING_MANAGER
        action peerReject(comment : String) returns ShiftSwapRequests;  // -> REJECTED
        action approve(comment : String) returns ShiftSwapRequests;     // -> APPROVED, update schedules
        action rejectRequest(comment : String) returns ShiftSwapRequests;
        action cancel() returns ShiftSwapRequests;
    };

    entity ApprovalHistory as projection on hr.ApprovalHistory;

    /* ---- Unbound functions used by dashboards (computed server-side) ---- */
    type EmployeeDashboard {
        availableEL : Integer;  availableSL : Integer;
        availableCL : Integer;  availableComp : Decimal(4,2);
        pendingLeave : Integer; approvedLeave : Integer;
        weeklyWorkingHours : Decimal(5,2); remainingWeeklyHours : Decimal(5,2);
        pendingOvertime : Integer; approvedOvertimeHours : Decimal(5,2);
        complianceAlerts : Integer;
    };

    type ManagerDashboard {
        totalTeam : Integer; present : Integer; onLeave : Integer;
        pendingLeaveApprovals : Integer; pendingOvertimeApprovals : Integer;
        pendingSwapRequests : Integer; staffingPercent : Decimal(5,2);
        complianceAlerts : Integer;
    };

    type LeaveCalcResult {
        workingDays : Decimal(5,1);
        isBlocked   : Boolean;
        medicalCertRequired : Boolean;
        messages    : String(2000);
    };

    type SwapCandidate {
        employeeNo      : String(10);
        fullName        : String(101);
        department_code : String(20);
        skillMatch      : Boolean;
        messages        : String(500);
    };

    function getEmployeeDashboard(employeeNo : String) returns EmployeeDashboard;
    function getManagerDashboard(managerNo : String) returns ManagerDashboard;
    function calculateLeaveDays(employeeNo : String, leaveTypeCode : String, startDate : Date, endDate : Date)
        returns LeaveCalcResult;
    function getSwapCandidates(employeeNo : String, assignment_ID : String) returns array of SwapCandidate;
}
