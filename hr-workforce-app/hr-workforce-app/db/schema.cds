namespace my.hr;

using { cuid, managed } from '@sap/cds/common';

/**
 * HR Workforce Management – Leave, Shift Scheduling & Overtime
 * Canonical data model. All UI bindings and service projections derive from here.
 *
 * Key strategy (IMPORTANT for FK consistency):
 *  - Master entities with natural keys use `managed` + a business `key`
 *    (Departments.code, Employees.employeeNo, LeaveTypes.code, ShiftTemplates.code).
 *    Associations to them store the business key in a `*_ID` / `*_code` column
 *    via explicit `on` conditions, so the UI binds FKs by readable business keys.
 *  - Transactional entities use `cuid` (UUID ID) + `managed`; compositions
 *    between them store the parent UUID in `*_ID` columns.
 *  - Status / enum-like fields are Strings with documented value domains.
 *  - All monetary values are Decimal(11,2); durations in minutes (Integer).
 */

/* ============================================================
 * 1. Departments  (natural key: code)
 * ========================================================== */
entity Departments : managed {
    key code        : String(20);
        name        : String(100) @mandatory;
        description : String(500);
        manager     : Association to Employees on manager.employeeNo = $self.manager_ID;
        manager_ID  : String(10);  // employeeNo of the department manager
        minCoveragePercent : Integer default 70;
        costCenter  : String(20);
        active      : Boolean default true;
}

/* ============================================================
 * 2. Employees  (natural key: employeeNo)
 * ========================================================== */
entity Employees : managed {
    key employeeNo    : String(10);
        firstName     : String(50) @mandatory;
        lastName      : String(50) @mandatory;
        fullName      : String(101);
        email         : String(120) @mandatory;
        department    : Association to Departments on department.code = $self.department_code;
        department_code: String(20);
        manager       : Association to Employees on manager.employeeNo = $self.manager_ID;
        manager_ID    : String(10);  // employeeNo of the line manager
        jobTitle      : String(80);
        roleCategory  : String(12); // EMPLOYEE | MANAGER | HR_ADMIN
        jurisdiction  : String(20) default 'IN-DEFAULT';
        baseHourlyRate: Decimal(9,2);
        weeklyRegularHours : Integer default 48;
        hireDate      : Date;
        status        : String(12) default 'ACTIVE'; // ACTIVE | INACTIVE | ON_LEAVE
        skills        : Composition of many EmployeeSkills on skills.employee_ID = $self.employeeNo;
        balances      : Composition of many LeaveBalances on balances.employee_ID = $self.employeeNo;
        shifts        : Composition of many ShiftAssignments on shifts.employee_ID = $self.employeeNo;
}

/* ============================================================
 * 3. LeaveTypes  (natural key: code)
 * ========================================================== */
entity LeaveTypes : managed {
    key code      : String(10);  // EL | SL | CL | COMP
        name      : String(50) @mandatory;
        description: String(200);
        allowNegativeBalance : Boolean default false;
        carryForwardEnabled  : Boolean default false;
        carryForwardMaxDays  : Integer default 0;
        exemptFromBlackout   : Boolean default false; // Sick Leave is exempt
        exemptFromAdvanceNotice : Boolean default false;
        medicalCertThresholdDays : Integer default 2;
        active    : Boolean default true;
}

/* ============================================================
 * 4. LeavePolicies (effective-dated entitlements per leave type)
 * ========================================================== */
entity LeavePolicies : cuid, managed {
        leaveType    : Association to LeaveTypes on leaveType.code = $self.leaveType_code;
        leaveType_code: String(10);
        annualEntitlement        : Integer;
        longLeaveThresholdDays   : Integer default 3;
        minAdvanceDaysForLongLeave: Integer default 7;
        effectiveFrom : Date;
        effectiveTo   : Date;
}

/* ============================================================
 * 5. LeaveBalances  (cuid; employee_ID holds employeeNo)
 * ========================================================== */
entity LeaveBalances : cuid, managed {
        employee      : Association to Employees on employee.employeeNo = $self.employee_ID;
        employee_ID   : String(10);
        leaveType     : Association to LeaveTypes on leaveType.code = $self.leaveType_code;
        leaveType_code: String(10);
        totalEntitlement : Integer;
        used             : Integer default 0;
        pending          : Integer default 0;
        available        : Integer;
        allowNegative    : Boolean default false;
}

/* ============================================================
 * 6. LeaveRequests  (cuid; UUID is the entity key)
 * ========================================================== */
entity LeaveRequests : cuid, managed {
        employee      : Association to Employees on employee.employeeNo = $self.employee_ID;
        employee_ID   : String(10);   // employeeNo
        employeeNo    : String(10);   // denormalised for quick filtering
        department_code: String(20);
        leaveType     : Association to LeaveTypes on leaveType.code = $self.leaveType_code;
        leaveType_code: String(10);
        startDate     : Date @mandatory;
        endDate       : Date @mandatory;
        days          : Decimal(5,1);
        reason        : String(500);
        status        : String(20) default 'DRAFT';
        // DRAFT | SUBMITTED | PENDING_MANAGER | APPROVED | REJECTED | SENT_BACK | CANCELLED
        approver_ID   : String(10);   // employeeNo of approver
        managerComment: String(500);
        medicalCertRequired : Boolean default false;
        medicalCertProvided: Boolean default false;
        coverageOverrideApplied : Boolean default false;
        coverageOverrideReason  : String(500);
        attachments   : Composition of many LeaveAttachments on attachments.request_ID = $self.ID;
        approvals     : Composition of many ApprovalHistory
                            on approvals.request_ID = $self.ID and approvals.requestType = 'LEAVE';
}

/* ============================================================
 * 7. LeaveAttachments (media; cuid)
 * ========================================================== */
entity LeaveAttachments : cuid, managed {
        request    : Association to LeaveRequests on request.ID = $self.request_ID;
        request_ID : String(36);   // UUID of LeaveRequests
        fileName   : String(200) @mandatory;
        mediaType  : String(100);
        @Core.MediaType: mediaType
        content    : LargeBinary;
}

/* ============================================================
 * 8. CompanyHolidays  (cuid)
 * ========================================================== */
entity CompanyHolidays : cuid, managed {
        holidayDate : Date @mandatory;
        name        : String(100) @mandatory;
        jurisdiction: String(20) default 'ALL';
        halfDay     : Boolean default false;
}

/* ============================================================
 * 9. BlackoutPeriods  (cuid)
 * ========================================================== */
entity BlackoutPeriods : cuid, managed {
        startDate   : Date @mandatory;
        endDate     : Date @mandatory;
        reason      : String(200);
        jurisdiction: String(20) default 'ALL';
        appliesToAllLeaveTypes : Boolean default false;
        leaveTypes  : String(200); // comma separated codes (EL,CL) — SL exempt via LeaveTypes.exemptFromBlackout
}

/* ============================================================
 * 10. ShiftTemplates  (natural key: code)
 * ========================================================== */
entity ShiftTemplates : managed {
    key code      : String(20); // MORNING | GENERAL | NIGHT | ...
        name      : String(50) @mandatory;
        startTime : String(5); // HH:mm 24h
        endTime   : String(5); // HH:mm 24h (may be next day)
        crossesMidnight : Boolean default false;
        color     : String(7); // hex for PlanningCalendar legend
        active    : Boolean default true;
}

/* ============================================================
 * 11. ShiftAssignments  (cuid)
 * ========================================================== */
entity ShiftAssignments : cuid, managed {
        employee      : Association to Employees on employee.employeeNo = $self.employee_ID;
        employee_ID   : String(10);
        employeeNo    : String(10);
        department_code: String(20);
        template      : Association to ShiftTemplates on template.code = $self.template_code;
        template_code : String(20);
        shiftDate     : Date @mandatory;
        startTime     : String(5);
        endTime       : String(5);
        crossesMidnight : Boolean default false;
        status        : String(12) default 'ASSIGNED'; // ASSIGNED | SWAPPED | CANCELLED
        originSwap_ID : String(36);
}

/* ============================================================
 * 12. ShiftSwapRequests  (cuid; employee FKs hold employeeNo)
 * ========================================================== */
entity ShiftSwapRequests : cuid, managed {
        requestor       : Association to Employees on requestor.employeeNo = $self.requestor_ID;
        requestor_ID    : String(10);   // employeeNo
        targetEmployee  : Association to Employees on targetEmployee.employeeNo = $self.targetEmployee_ID;
        targetEmployee_ID : String(10); // employeeNo
        assignment      : Association to ShiftAssignments on assignment.ID = $self.assignment_ID;
        assignment_ID   : String(36);   // UUID of ShiftAssignments
        targetAssignment_ID : String(36);
        reason          : String(500);
        status          : String(20) default 'SUBMITTED';
        // SUBMITTED | PENDING_PEER | PENDING_MANAGER | APPROVED | REJECTED | CANCELLED
        peerAcceptedAt : DateTime;
        peerComment     : String(500);
        approver_ID     : String(10);   // employeeNo
        managerComment  : String(500);
        eligibilityCheckPassed : Boolean default false;
        eligibilityMessages    : String(1000);
        approvals       : Composition of many ApprovalHistory
                             on approvals.request_ID = $self.ID and approvals.requestType = 'SWAP';
}

/* ============================================================
 * 13. OvertimeRequests  (cuid)
 * ========================================================== */
entity OvertimeRequests : cuid, managed {
        employee      : Association to Employees on employee.employeeNo = $self.employee_ID;
        employee_ID   : String(10);
        employeeNo    : String(10);
        department_code: String(20);
        workDate      : Date @mandatory;
        regularShiftHours : Decimal(4,1) default 0;
        otStart       : String(5);
        otEnd         : String(5);
        otMinutes     : Integer;
        otHours       : Decimal(5,2);
        otType        : String(10); // WEEKDAY | WEEKEND | HOLIDAY
        multiplier    : Decimal(3,2);
        baseHourlyRate: Decimal(9,2);
        estimatedAmount: Decimal(11,2);
        compOffCredits : Decimal(4,2) default 0;
        convertToCompOff : Boolean default false;
        reason        : String(500) @mandatory;
        attachmentFileName : String(200);
        status        : String(20) default 'DRAFT';
        approver_ID   : String(10);
        managerComment: String(500);
        complianceMessages : String(1000);
        approvals     : Composition of many ApprovalHistory
                            on approvals.request_ID = $self.ID and approvals.requestType = 'OVERTIME';
}

/* ============================================================
 * 14. OvertimePolicies  (cuid; effective dated)
 * ========================================================== */
entity OvertimePolicies : cuid, managed {
        otType      : String(10); // WEEKDAY | WEEKEND | HOLIDAY
        multiplier  : Decimal(3,2);
        compOffConversionRate : Decimal(4,2) default 1.0;
        effectiveFrom : Date;
        effectiveTo   : Date;
        jurisdiction  : String(20) default 'ALL';
}

/* ============================================================
 * 15. ComplianceRules  (cuid; jurisdiction + effective dated)
 * ========================================================== */
entity ComplianceRules : cuid, managed {
        jurisdiction    : String(20);
        dailyMaxHours   : Integer default 12;
        weeklyRegularHours   : Integer default 48;
        weeklyOTAllowance    : Integer default 12;
        weeklyMaxHours       : Integer default 60;
        quarterlyOTLimit     : Integer default 50;
        quarterlyWarnAt      : Integer default 40;
        minRestHours         : Integer default 11;
        effectiveFrom        : Date;
        effectiveTo          : Date;
}

/* ============================================================
 * 16. ApprovalHistory  (cuid; polymorphic via requestType)
 * ========================================================== */
entity ApprovalHistory : cuid, managed {
        requestType : String(10); // LEAVE | OVERTIME | SWAP
        request_ID  : String(36); // UUID of the parent request
        approver_ID : String(10); // employeeNo
        approverName: String(120);
        action      : String(15); // APPROVED | REJECTED | SENT_BACK | SUBMITTED | CANCELLED | OVERRIDE
        fromStatus  : String(20);
        toStatus    : String(20);
        comments    : String(500);
        timestamp   : DateTime @readonly;
}

/* ============================================================
 * 17. AuditLogs  (immutable, cuid)
 * ========================================================== */
entity AuditLogs : cuid {
        timestamp   : DateTime @readonly @cds.on.insert : $now;
        userId      : String(50);
        action      : String(40);
        entityType  : String(30);
        entityId    : String(40);
        prevValue   : String(2000);
        newValue    : String(2000);
        reason      : String(500);
}

/* ============================================================
 * 18. EmployeeSkills  (cuid)
 * ========================================================== */
entity EmployeeSkills : cuid, managed {
        employee    : Association to Employees on employee.employeeNo = $self.employee_ID;
        employee_ID : String(10);
        skill       : String(60) @mandatory;
        proficiency : String(12) default 'INTERMEDIATE';
}

/* ============================================================
 * 19. EmployeeWorkHours  (cuid; daily aggregate)
 * ========================================================== */
entity EmployeeWorkHours : cuid, managed {
        employee      : Association to Employees on employee.employeeNo = $self.employee_ID;
        employee_ID   : String(10);
        workDate      : Date;
        weekKey       : String(10); // YYYY-Www
        quarterKey    : String(7);  // YYYY-Qn
        regularMinutes: Integer default 0;
        otMinutes     : Integer default 0;
        totalHours    : Decimal(5,2);
}

/* ============================================================
 * 20. CompOffTransactions  (cuid)
 * ========================================================== */
entity CompOffTransactions : cuid, managed {
        employee       : Association to Employees on employee.employeeNo = $self.employee_ID;
        employee_ID    : String(10);
        sourceType     : String(10); // OVERTIME | ADJUSTMENT
        sourceRequest_ID: String(36);
        creditsEarned  : Decimal(4,2) default 0;
        creditsUsed    : Decimal(4,2) default 0;
        balanceAfter   : Decimal(4,2);
        transactionDate: Date;
        reason         : String(200);
}
