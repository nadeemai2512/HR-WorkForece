# HR Workforce Management — Leave, Shift Scheduling & Overtime

An enterprise-grade **SAP BTP** application built with **SAP CAP (Node.js)**, **SAPUI5 / Fiori**, **OData V4**, and **SAP XSUAA**. It centralizes employee leave, shift scheduling, shift-swap, and overtime compliance with automated policy validation, manager approval workflows, audit trails, and payroll-ready reporting.

> **Verification status:** the backend compiles cleanly (`cdsc`), deploys to SQLite with seed data (`cds-deploy`), serves OData V4 with mock + XSUAA auth, and **all 31 automated tests pass** (12 date-utility unit tests + 19 service integration tests). See [Test results](#test-results).

---

## 1. Features implemented

### Leave management
- Leave types: Earned (EL), Sick (SL), Casual (CL), Comp-Off (COMP) with per-type negative-balance, blackout exemption, advance-notice exemption, and medical-certificate threshold configuration.
- Automatic working-day calculation excluding weekends + configured holidays (half-day holidays count as 0.5).
- Leave balance validation (block when `requested > available` unless `allowNegativeBalance`).
- Blackout-date enforcement (Sick Leave exempt).
- Configurable minimum advance notice for long leave (Sick Leave exempt).
- Medical-certificate requirement when Sick Leave exceeds the configured consecutive-day threshold.
- Duplicate / overlapping leave detection.
- Team coverage validation before approval (department minimum staffing %, default 70 %); documented manager/HR override recorded in the audit log.

### Shift scheduling
- Configurable shift templates (Morning 06:00–14:30, General 09:00–18:00, Night 22:00–06:30).
- Shift assignment with **mandatory 11-hour rest-period validation** across consecutive, overnight, and cross-day shifts (configurable per jurisdiction).
- Shift-swap workflow: submit → peer accept → manager approve → schedule reassignment, with skill-match, availability, leave-conflict, shift-conflict, and rest-period eligibility checks.

### Overtime & labor compliance
- Overtime entry with backend-computed duration, type detection (weekday/weekend/holiday), configurable multipliers (1.5× / 2.0× / 2.5×), estimated amount, and optional comp-off conversion.
- Daily (12 h), weekly (48 regular + 12 OT = 60 h max), and quarterly (50 h, warn at 40 h) compliance checks — all configurable per jurisdiction and effective-dated.
- Duplicate / overlap prevention against approved leave, assigned shifts, and other overtime.
- Overtime approval writes daily work-hours aggregates and grants comp-off credits.

### Approvals, audit, reporting
- Status workflows enforced on the backend (Draft → Submitted → Pending Manager → Approved/Rejected/Sent Back/Cancelled; Swap: Submitted → Pending Peer → Pending Manager → Approved/Rejected/Cancelled).
- Immutable audit log for every state change, balance adjustment, coverage override, and policy change.
- CSV exports: monthly overtime, leave utilization, unpaid leave, department attendance, payroll-ready overtime (approved only, distinct from estimated), compliance, audit logs.

### Security
- XSUAA role collections **Employee_Role**, **Manager_Role**, **HR_Admin_Role** mapped to scopes `Employee`, `Manager`, `HRAdmin`.
- Instance-based authorization enforced **on the backend** via READ hooks (employees see only own records, managers see direct reports, HR sees all) and `assertCanAccessEmployee` on every create/action.
- Transaction-safe approvals (balance deduction + status update + audit + comp-off + work-hours commit atomically per request).

---

## 2. Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | SAPUI5 / OpenUI5 1.120, Fiori 3, XML views, MVC, `sap.m.PlanningCalendar`, `sap.m.Table`, JSONModel + OData V4 model |
| Backend | SAP CAP Node.js (cds 10), CDS data modeling, OData V4, server-side handlers |
| Security | SAP XSUAA, `@sap/xssec`, role-based + instance-based authorization |
| DB | SAP HANA Cloud (prod) / `@cap-js/sqlite` (local & test) |
| Deploy | SAP BTP Cloud Foundry, MTA, Application Router, XSUAA, HDI container |

---

## 3. Project structure

```
hr-workforce-app/
├── db/
│   ├── schema.cds                  # 20 CDS entities + associations (canonical model)
│   └── data/                       # 12 seed CSVs (Departments, Employees, LeaveTypes, …)
├── srv/
│   ├── service.cds                 # HRService OData V4 projections + bound actions + functions
│   ├── service.js                  # Handlers: leave, overtime, shift, swap, approvals, dashboards, auth hooks
│   └── lib/
│       ├── dateUtils.js            # Pure date/shift math (unit-tested)
│       ├── leaveCalc.js            # Leave validation & balance logic
│       ├── overtimeCalc.js         # OT duration/multiplier/amount + daily/weekly/quarterly checks
│       ├── coverage.js             # Team staffing coverage validation
│       ├── restPeriod.js           # 11-hour rest-period validation (cross-midnight aware)
│       ├── audit.js                # Immutable audit-log writer
│       └── auth.js                 # XSUAA scope checks + instance-based authorization helpers
├── app/fiori/                      # SAPUI5 app
│   ├── package.json, ui5.yaml      # UI5 tooling + /odata proxy to localhost:4004
│   └── webapp/
│       ├── manifest.json           # Routing (17 targets) + OData V4 model + i18n
│       ├── Component.js, index.html
│       ├── i18n/i18n.properties
│       ├── css/style.css
│       ├── model/{models,formatter,odata}.js
│       ├── view/       (17 XML views: EmployeeDashboard, LeaveList/Create/Detail, OvertimeList/Create,
│       │                 MyShifts, ShiftSwapCreate, ManagerDashboard, TeamPlanningCalendar, Approvals,
│       │                 HREmployees, HRLeavePolicy, HRShiftConfig, HRCompliance, Reports, AuditLogs)
│       ├── controller/  (17 matching controllers)
│       └── fragment/   (ApprovalDialog, EmployeeDialog)
├── approuter/                      # XSUAA-secured app router + xs-app.json routes
├── test/
│   ├── dateUtils.test.js           # 12 pure unit tests
│   └── business.test.js            # 19 integration tests (cds.test + mock auth)
├── mta.yaml                        # BTP MTA (uaa, hdi, srv, approuter, destination)
├── xs-security.json                # Scopes, attributes, role-templates, role-collections
├── .cdsrc.json                     # [development]/[test]/[production] profiles (mock auth + sqlite/hana)
├── package.json, .mocharc.yml, .env.example, .gitignore
└── README.md
```

---

## 4. Run locally

Prerequisites: **Node.js ≥ 20**, npm.

```bash
cd hr-workforce-app
npm install                 # installs @sap/cds, @cap-js/sqlite, @sap/xssec, mocha, chai, ui5 tooling deps

# 1) Deploy the model + seed data to a local SQLite DB
npx cds-deploy              # or: ./node_modules/.bin/cds-deploy

# 2) Start the CAP backend (OData V4 at http://localhost:4004/odata/v4/hr)
NODE_ENV=development npx cds-serve   # or: ./node_modules/.bin/cds-serve
```

Mock users (defined in `.cdsrc.json` `[development]`) — login with `username = password`:

| User | Password | Role | employeeNo |
| --- | --- | --- | --- |
| alice | alice | HR Admin | E1001 |
| bob | bob | Manager (Operations) | E1002 |
| frank | frank | Manager (IT) | E1006 |
| carol | carol | Employee | E1003 |
| david | david | Employee | E1004 |
| eve | eve | Employee | E1005 |

Quick check:
```bash
curl -u carol:carol http://localhost:4004/odata/v4/hr/Employees
curl -u alice:alice "http://localhost:4004/odata/v4/hr/Employees?\$count=true"
curl -u carol:carol "http://localhost:4004/odata/v4/hr/getEmployeeDashboard(employeeNo='E1003')"
curl -u carol:carol "http://localhost:4004/odata/v4/hr/calculateLeaveDays(employeeNo='E1003',leaveTypeCode='EL',startDate=2026-12-07,endDate=2026-12-11)"
```

### Run the UI5 frontend
```bash
cd app/fiori
npm install
npm start            # ui5 serve on http://localhost:8080 (proxies /odata -> localhost:4004)
```
Open `http://localhost:8080/webapp/index.html`. Log in with one of the mock users above (browser basic-auth prompt).

### Run the tests
```bash
# from project root
NODE_ENV=test npx mocha          # 31 passing
```

---

## 5. OData V4 endpoints

Service root: `/odata/v4/hr`

**Entity sets** (all support `$filter`, `$select`, `$expand`, `$orderby`, `$count`, server-driven pagination):
`Departments, Employees, EmployeeSkills, LeaveTypes, LeavePolicies, LeaveBalances, LeaveRequests, LeaveAttachments, CompanyHolidays, BlackoutPeriods, ShiftTemplates, ShiftAssignments, ShiftSwapRequests, OvertimeRequests, OvertimePolicies, ComplianceRules, ApprovalHistory, AuditLogs, EmployeeWorkHours, CompOffTransactions`

**Bound actions**
- `LeaveRequests(ID=…)/submit`, `/approve(comment=…)`, `/rejectRequest(comment=…)`, `/sendBack(comment=…)`, `/cancel`, `/applyCoverageOverride(reason=…)`, `/recalcDays`
- `OvertimeRequests(ID=…)/submit`, `/approve(comment=…)`, `/rejectRequest(comment=…)`, `/sendBack(comment=…)`, `/cancel`, `/recalc`
- `ShiftSwapRequests(ID=…)/submit`, `/peerAccept(comment=…)`, `/peerReject(comment=…)`, `/approve(comment=…)`, `/rejectRequest(comment=…)`, `/cancel`

**Function imports**
- `getEmployeeDashboard(employeeNo)`
- `getManagerDashboard(managerNo)`
- `calculateLeaveDays(employeeNo, leaveTypeCode, startDate, endDate)` → `{ workingDays, isBlocked, medicalCertRequired, messages }`
- `getSwapCandidates(employeeNo, assignment_ID)`

---

## 6. Database entities (20)

`Departments, Employees, LeaveTypes, LeavePolicies, LeaveBalances, LeaveRequests, LeaveAttachments, CompanyHolidays, BlackoutPeriods, ShiftTemplates, ShiftAssignments, ShiftSwapRequests, OvertimeRequests, OvertimePolicies, ComplianceRules, ApprovalHistory, AuditLogs, EmployeeSkills, EmployeeWorkHours, CompOffTransactions`

Key design choice: master entities (`Employees`, `Departments`, `LeaveTypes`, `ShiftTemplates`) use natural business keys (`employeeNo` / `code`) so UI FKs bind by readable values; transactional entities use `cuid` UUIDs. All associations use explicit `on` conditions; every entity carries `managed` audit fields (`createdAt/createdBy/modifiedAt/modifiedBy`).

---

## 7. Test results

`NODE_ENV=test npx mocha` → **31 passing, 0 failing**.

Coverage (positive, negative, boundary, authorization):
- Role-based & instance-based READ (HR all / employee self-only / manager team-only / cross-employee filter blocked)
- `calculateLeaveDays`: working-day count, blackout block, medical-certificate requirement, insufficient-balance block, advance-notice block
- Leave: create → submit (balance reserved) → manager approve (balance consumed + audit log)
- Overtime: create → submit (multiplier 1.5× weekday) → manager approve (work-hours written + comp-off credits)
- Shift rest-period: 11 h violation rejected (400)
- Shift swap: create → submit → peer accept → manager approve → assignment reassigned
- Date utils: working days, weekends, holidays (incl. half-day), cross-midnight minutes, ISO week/quarter, rest-minute computation

---

## 8. Deploy to SAP BTP Cloud Foundry

Prerequisites: BTP subaccount, Cloud Foundry CLI (`cf`), MTA build tool (`mbt`), entitlements for XSUAA, SAP HANA Cloud, Destination service.

```bash
# 1) Build the UI5 app into the approuter resources
cd app/fiori && npm install && npm run build-deploy && cd ../..

# 2) Build the MTA archive
npm install
mbt build -t ./mta_archives

# 3) Deploy
cf deploy ./mta_archives/hr-workforce-app_1.0.0.mtar

# 4) Create the XSUAA service instance from xs-security.json (if not created by the deployer)
cf create-service xsuaa application hr-workforce-uaa -c xs-security.json

# 5) Assign role collections to users in the BTP cockpit:
#    Employee_Role, Manager_Role, HR_Admin_Role
#    For each user, set the custom attribute employeeNo = their employee number.
```

After deploy: open the approuter URL, log in via XSUAA, the approuter forwards `/odata/*` to the CAP service (JWT forwarded) and serves the UI from `/webapp`.

> **HANA**: the `[production]` profile binds `db = hana`. The HDI container is created from `gen/db` by the `hr-workforce-db` MTA module. Seed data loads automatically on first deploy.

---

## 9. Configuration notes

- **Compliance thresholds** in `ComplianceRules` (daily 12 h, weekly 48+12=60 h, quarterly 50 h, rest 11 h) and **overtime multipliers** in `OvertimePolicies` (1.5/2.0/2.5) are **configurable examples**, not universal legal requirements. HR must configure the applicable jurisdiction, employee category, statutory limits, exceptions, and effective dates. Validate the actual rules before production use.
- **S/4HANA Time Management integration**: the design is integration-ready (destination placeholder in `.env.example`, OData entities map cleanly to S/4HANA time-management APIs). Integration is **not** claimed as complete — the destination, credentials, and field mapping must be created and tested in the BTP cockpit / SAP Integration Suite before use.

---

## 10. Known limitations

- The PlanningCalendar renders shift assignments per employee (color-coded by template). Leave / overtime / swap overlays in the same calendar require a unioned "calendar appointments" projection (the data exists; only the combined UI binding is not wired).
- File attachment upload uses base64-in-JSON for `LeaveAttachments.content`; for large files switch to CAP streaming media (`@Core.IsMedia`, `$value`) in production.
- `cds.test` integration tests run on in-memory SQLite under `NODE_ENV=test`; the Fiori UI itself is verified against the running backend via curl (no headless browser in the build env).
- Payroll export marks estimated vs approved amounts; final payroll posting still requires confirmation with the payroll/finance system.

---

## 11. Exact commands

```bash
# Local run
npm install
npx cds-deploy
NODE_ENV=development npx cds-serve      # backend :4004
cd app/fiori && npm install && npm start # UI :8080

# Tests
NODE_ENV=test npx mocha

# Build & deploy to BTP
cd app/fiori && npm run build-deploy && cd ../..
mbt build -t ./mta_archives
cf deploy ./mta_archives/hr-workforce-app_1.0.0.mtar
```
