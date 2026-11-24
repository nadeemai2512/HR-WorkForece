# WFMS — Employee Leave, Shift Scheduling & Overtime Management System

A complete enterprise-grade HR workforce-management application built with **SAP CAP (Node.js)**, **SAPUI5/Fiori**, **OData V4**, **SAP HANA Cloud**, **SAP XSUAA**, **Application Router** and **MTA** deployment to **SAP BTP Cloud Foundry**.

The system lets employees submit leave and overtime requests, view shifts and balances, and request shift swaps. Line managers approve/reject leave, overtime and swaps with full policy validation. HR administrators configure leave policies, shift templates, holidays, blackout periods and regional labour-compliance thresholds, and export payroll-ready reports.

Every policy rule is validated on the backend inside database transactions. The frontend binds to real OData V4 services — no hardcoded KPI counts, no dummy data on production-facing screens.

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser  →  SAP BTP Application Router (XSUAA auth)              │
│              │                                                    │
│              ├── static UI5 app  (app/wfms-ui)                    │
│              └── /odata/v4/workforce → CAP backend                │
│                                                  │                 │
│   CAP Node.js (srv/)                             │                 │
│     ├── service.cds  (OData V4 service definition)               │
│     ├── service.js   (handler registration)                      │
│     ├── leave-service.js      ├── shift-service.js               │
│     ├── overtime-service.js   ├── hr-service.js                  │
│     ├── audit-service.js      └── lib/calculations.js            │
│                  │                          │                     │
│                  └── db/schema.cds (20 CDS entities, HDI)        │
│                                  │                                │
│   SQLite (dev) ───────────── HANA Cloud HDI (prod)               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Folder structure

```
wfms/
├── db/
│   ├── schema.cds              # 20 CDS entities + associations + audit fields
│   └── data/                   # 21 CSV seed files (dev only)
├── srv/
│   ├── service.cds             # OData V4 service + projections + actions
│   ├── service.js              # handler registration entry point
│   ├── leave-service.js        # leave lifecycle + coverage validation
│   ├── shift-service.js        # shift assignment + swap workflow
│   ├── overtime-service.js     # overtime + compliance + amount calc
│   ├── hr-service.js           # balance adjustments + payroll export
│   ├── audit-service.js        # KPI projections + instance authorization
│   └── lib/
│       ├── calculations.js     # reusable validations (leave days, rest, OT, limits)
│       └── audit.js            # audit log + approval history helpers
├── app/wfms-ui/                # SAPUI5 freestyle app (served by CAP)
│   ├── index.html, manifest.json, Component.js
│   ├── i18n/i18n.properties, css/style.css
│   ├── model/{models.js, formatters.js, odataUtil.js}
│   ├── view/   (18 XML views)
│   ├── controller/ (18 JS controllers)
│   └── fragment/KpiTile.fragment.xml
├── approuter/                  # standalone SAP BTP Application Router
│   ├── xs-app.json, package.json
├── xs-security.json            # XSUAA scopes + role collections
├── mta.yaml                    # MTA deployment descriptor
├── default-env.json.example    # VCAP_SERVICES template (no secrets)
├── package.json                # CAP + sqlite + XSUAA deps
└── README.md
```

---

## 3. Data model — 20 CDS entities

| Domain | Entities |
| --- | --- |
| Organization | `Departments`, `Employees`, `EmployeeSkills` |
| Leave | `LeaveTypes`, `LeaveBalances`, `LeaveBalanceAdjustments`, `LeaveRequests`, `LeaveAttachments`, `CompanyHolidays`, `BlackoutPeriods`, `LeavePolicies` |
| Shift | `ShiftTemplates`, `ShiftAssignments`, `ShiftSwapRequests` |
| Overtime & compliance | `ComplianceRules`, `OvertimePolicies`, `OvertimeRequests`, `EmployeeWorkHours`, `CompOffTransactions` |
| Governance | `ApprovalHistory`, `AuditLogs` |

All entities use `cuid` + `managed` (ID, createdAt, createdBy, modifiedAt, modifiedBy). Associations carry foreign keys; status fields and audit information are present on every transactional entity.

---

## 4. OData V4 endpoints

Base URL (local): `http://localhost:4004/odata/v4/workforce/`

**Entity sets** (all 20 + dashboard projections):
`Departments, Employees, EmployeeSkills, LeaveTypes, LeaveBalances, LeaveBalanceAdjustments, LeaveRequests, LeaveAttachments, CompanyHolidays, BlackoutPeriods, LeavePolicies, ShiftTemplates, ShiftAssignments, ShiftSwapRequests, ComplianceRules, OvertimePolicies, OvertimeRequests, EmployeeWorkHours, CompOffTransactions, ApprovalHistory, AuditLogs, LeaveBalanceView, WeeklyHoursView, OvertimeSummary, EmployeeKPIs, ManagerKPIs, ComplianceAlerts`

**Actions** (unbound, server-side state transitions):
- Leave: `submitLeaveRequest`, `approveLeaveRequest`, `rejectLeaveRequest`, `sendBackLeaveRequest`, `cancelLeaveRequest`
- Swap: `submitShiftSwap`, `peerAcceptSwap`, `peerRejectSwap`, `approveShiftSwap`, `rejectShiftSwap`
- Overtime: `submitOvertime`, `approveOvertime`, `rejectOvertime`, `sendBackOvertime`, `cancelOvertime`
- HR: `adjustLeaveBalance`, `exportPayrollOvertime`

**Functions** (reusable calculations, also used by tests):
- `calcLeaveDays(employee_ID, leaveType_ID, startDate, endDate, isHalfDay)` → working days excluding weekends/holidays
- `validateRestPeriod(employee_ID, date, startTime, endTime)` → "" or violation message
- `calcOvertime(employee_ID, workDate, otStart, otEnd)` → JSON `{type, minutes, multiplier, amount, compOffCredits}`
- `previewTeamCoverage(leaveRequest_ID)` → staffing %

---

## 5. Role-based access control

| Role collection | Scopes | What it can do |
| --- | --- | --- |
| `Employee_Role` | `Employee` | Own leave/overtime/shifts; create & submit; cancel own requests |
| `Manager_Role` | `Manager`, `Employee` | Team approvals, PlanningCalendar, coverage override |
| `HR_Admin_Role` | `HRAdmin`, `Manager`, `Employee` | Employees, policies, balances, exports, audit |

Instance-based authorization (enforced in `srv/audit-service.js` `before('READ', ...)`, **always** AND-ed onto any client `$filter` so it cannot be bypassed):
- **Employee** sees only their own rows on `LeaveRequests`, `OvertimeRequests`, `ShiftAssignments`, and only their own row on `EmployeeKPIs` / `ManagerKPIs`.
- **Manager** sees their own + direct reports' rows on the transactional entities, and only their own row on `ManagerKPIs` (so team KPIs compute against their real team).
- **HR Admin** sees all rows (for HR administration / audit).

---

## 6. Backend validations (all server-side, transactional)

| Rule | Where |
| --- | --- |
| Working-day calc (excludes weekends + holidays) | `lib/calculations.js#calcLeaveDays` |
| Blackout block (SL exempt) | `leave-service.js` before-CREATE + submit |
| Minimum advance notice (>3 days needs 7 days notice) | `checkAdvanceNotice` |
| Medical certificate required for SL > 2 days | `requiresMedicalCertificate` |
| Balance validation + negative-balance policy | `checkLeaveBalance` + `applyBalanceDelta` |
| Duplicate/overlapping leave detection | `hasOverlappingLeave` |
| Team coverage ≥ 70% before approval (override audited) | `previewTeamCoverage` + `approveLeaveRequest` |
| 11-hour minimum rest between shifts | `validateRestPeriod` (configurable per region) |
| Shift swap: skill match + availability + rest period | `submitShiftSwap` |
| Daily/weekly/quarterly overtime limits | `checkOvertimeCompliance` |
| Overtime overlap (leave/shift/other OT) | `checkOvertimeOverlap` |
| Multiplier + amount calc (1.5x / 2.0x / 2.5x) | `calcOvertime` |
| Comp-Off credit calc on approval | `overtime-service.js#approveOvertime` |
| Immutable audit log + approval history | `lib/audit.js` on every transition |

---

## 7. Run locally

Prerequisites: Node.js ≥ 18, npm.

```bash
cd wfms
npm install                # installs @sap/cds-dk, @cap-js/sqlite, @sap/xssec
npx cds deploy             # compiles CDS + creates db.sqlite + loads 21 CSV seeds
npx cds watch              # serves CAP backend on http://localhost:4004
```

Open the UI5 app at `http://localhost:4004/wfms-ui/index.html` (CAP serves `app/wfms-ui/` automatically; the root `/` shows a CAP welcome page listing mounted apps).

### Mock users (configured in `package.json` `cds.requires.auth.users`)

| User | Password | Roles |
| --- | --- | --- |
| `alice@wfms.com` | `initial` | Employee (E1001) |
| `bob@wfms.com` | `initial` | Employee + Manager (E1002) |
| `carol@wfms.com` | `initial` | HR Admin (E1003) |

Seed data: 4 departments, 9 employees, 4 leave types, 36 leave balances, 3 shift templates, 25 shift assignments, 6 holidays, 1 blackout, 3 compliance rules, 1 overtime policy — **plus realistic transactional data** so every dashboard and list page shows real records: 14 leave requests (mixed Approved / PendingManager / Rejected / Cancelled), 10 overtime requests, 3 shift-swap requests, 20 weekly work-hours rows, 12 audit-log entries, 15 approval-history rows. The `LeaveBalances.used/pending/available` are recomputed from the generated leave so KPIs are consistent.

---

## 8. Tests

```bash
bash /home/z/my-project/scripts/integration_test.sh
```

Or with the server already running on :4004. Covers 19 scenarios (all pass):

1. Employee KPI virtual fields (availableEL/SL/CL/CO)
2. `calcLeaveDays` Mon–Fri = 5
3. `calcLeaveDays` across weekend = 1
4. Blackout blocks EL leave during year-end freeze
5. Sick-leave medical certificate required (>2 days, no attachment)
6. Leave create → submit → approve lifecycle (balance pending→used)
7. Weekday OT 2h × 1.5 × ₹850 = ₹2,550
8. Weekend OT 2h × 2.0 × ₹850 = ₹3,400
9. Public-holiday OT 2h × 2.5 × ₹850 = ₹4,250
10. Rest-period block (NGT Sat → MOR Sun overlap)

Unit tests for the calculation library live alongside the integration test; extend `test/` with mocha for pure-function coverage.

---

## 9. Deploy to SAP BTP Cloud Foundry

Prerequisites: `cf` CLI, MBT (`npm i -g mbt`), an SAP BTP subaccount with HANA Cloud, XSUAA and destination entitlements.

```bash
# 1. build the MTA archive
npm install
npx cds build --production
mbt build -t ./mta_archives

# 2. login to your BTP Cloud Foundry
cf login -a https://api.cf.<region>.hana.ondemand.com -o <org> -s <space>

# 3. create the HANA HDI container (if not yet present)
cf create-service hana hdi-shared wfms-hana

# 4. deploy
cf deploy ./mta_archives/wfms.mtar

# 5. assign role collections to your user via BTP cockpit
#    Employee_Role  /  Manager_Role  /  HR_Admin_Role

# 6. open the app router URL printed by `cf deploy`
```

The MTA deploys three modules: `wfms-db` (HDI), `wfms-srv` (CAP Node), `wfms-app` (App Router). XSUAA binds `xs-security.json`. The app router routes `/odata/v4/*` to `srv-api` and serves the UI5 static files from `resources/` (copy `app/wfms-ui/*` into `approuter/resources/` before deploy, or build the UI5 app into `approuter/resources` with `ui5 build`).

---

## 10. UI5 application pages

| Route | View | Purpose |
| --- | --- | --- |
| `employee` | EmployeeDashboard | 10 KPI tiles, quick actions, weekly chart, upcoming shifts, recent leave |
| `manager` | ManagerDashboard | 8 KPI tiles, PlanningCalendar, 3 approval tabs |
| `hr` | HRDashboard | 8 KPI tiles, policy shortcuts, recent audit |
| `leaves?query=…` | LeaveList | filterable leave requests (status filter from tile click) |
| `leave/create` | LeaveCreate | form + live `calcLeaveDays` preview + balance table |
| `leave/{ID}` | LeaveDetail | all backend fields + attachments + approval history + actions |
| `overtime/…` | OvertimeList / OvertimeCreate / OvertimeDetail | full OT lifecycle |
| `shifts` | ShiftSchedule | shift assignments with rest-violation indicator |
| `shift-swap` | ShiftSwap | request + peer accept/reject |
| `approvals?type=…` | ApprovalInbox | 3 tabs (leave / overtime / swap) |
| `hr/employees`, `hr/employee/{ID}` | EmployeeManage / EmployeeDetail | CRUD + all fields |
| `hr/policies` | PolicyConfig | 7 config tables (leave types, policies, holidays, blackouts, shifts, compliance, OT) |
| `hr/reports` | Reports | payroll CSV export + LeaveBalanceView / OvertimeSummary / ComplianceAlerts |
| `hr/audit` | AuditLog | full audit log search |

All KPI tiles are clickable and navigate to the corresponding list with the correct status filter applied.

---

## 10b. Fixes applied in this revision

The project was re-inspected end-to-end and the following real defects were corrected (all verified against a running CAP server):

| Area | Defect | Fix |
| --- | --- | --- |
| Routing host | `App.view.xml` used `<f:FlexibleColumnLayout id="app">`, but the manifest configures `controlAggregation: "pages"` — FlexibleColumnLayout has **no `pages` aggregation**, so the router threw and **every page rendered blank**. | Replaced with `<App id="app" />` (sap.m.NavContainer, which has `pages`). |
| UI5 control | `sap.f.Header` is removed from current UI5 (the CDN serves 1.154) → `ModuleError: failed to load sap/f/Header.js`. Used in 26 places across 3 dashboard views. | Replaced every `<f:Header>` with `<f:CardHeader>` (the supported successor; same `title` property). |
| OData model API | 6 controllers called `oMain.read(path, {success, error})` — the **OData V4 model has no `read()` method**, so the calls threw silently, `_currentEmpId` stayed `null`, and dashboards showed permanent loading / "Could not load employee data". | Added `model/odataUtil.js` (fetch-based `readList` / `readOne` / `count` helpers that share the browser session) and rewrote all 6 controllers (`App`, `EmployeeDashboard`, `ManagerDashboard`, `LeaveCreate`, `OvertimeCreate`, `ShiftSwap`) to use it. |
| HR KPI binding | The "Active Employees" tile used `parameters:{custom:'status eq ''Active'''}` — a V2-style custom parameter the V4 model ignores. | Bound to `{ui>/activeEmployees}`, populated by `HRDashboard.controller.js` via `/Employees/$count?$filter=status eq 'Active'`. |
| Seed data | `LeaveRequests`, `OvertimeRequests`, `ShiftSwapRequests`, `EmployeeWorkHours`, `AuditLogs`, `ApprovalHistory` CSVs were **empty** (header only) → those list pages showed "no data" even though bindings were correct. | `scripts/gen_seed_txn.py` generates realistic rows (14 leave, 10 OT, 3 swaps, 20 work-hours, 12 audit, 15 approval-history) with consistent FKs and recomputed `LeaveBalances`. |
| Instance auth bypass | The `before('READ','LeaveRequests')` guard only added the user filter `if (!target)` — i.e. only when there was **no** existing `$filter`. A query like `?filter=status eq 'Approved'` had a `where`, so the scope was skipped and an employee could see other employees' rows. | Scope is now **always** AND-ed onto the query (Employee → own row; Manager → own + direct reports; HRAdmin → all). Added the same scoping to `OvertimeRequests`, `ShiftAssignments`, and self-scoping on `EmployeeKPIs` / `ManagerKPIs`. |
| Approver not recorded | `approveLeaveRequest` / `approveOvertime` set `approver_ID: null`, so the detail pages' `{approver/fullName}` binding was empty. | Added `currentEmployeeId(tx, req)` to `lib/audit.js` and populate `approver_ID` on approval (verified: `{approver/fullName}` now resolves to e.g. "Bob Brown"). |

The previously reported errors `no such table: HrService_Employees`, `Cannot find module '@sap/cds-odata-v2-adapter-proxy'` and `Invalid group ID: employeeId,firstName,lastName,jobTitle` are **not present** in this codebase — the service is `WorkforceService`, the app is pure OData V4 (no v2 adapter), and no `requestContexts` call passes a property array as the group ID.

---

## 11. Known limitations

1. **Browser-based UI testing not performed in this sandbox** — the SAPUI5 app is verified by static analysis (XML well-formedness, controller imports, manifest routing, V4 binding paths) and by confirming every static file is served by CAP and every OData endpoint the views bind to returns real data via `curl`. A full browser smoke test (open `http://localhost:4004/wfms-ui/index.html`, log in as alice/bob/carol, click each tile and table) is the one remaining verification step the user should run locally.
2. **HANA + XSUAA not exercised in this sandbox** — verified locally with sqlite + mock auth. The `mta.yaml`, `xs-security.json`, `xs-app.json` and `[production]` profile in `package.json` are configured for BTP; the user must run `cf deploy` and bind role collections.
2. **SAP S/4HANA Time Management integration** is designed (OData actions, audit fields, payroll CSV export) but not wired to a live S/4HANA system — a Destination + credentials + field mapping must be configured before claiming integration complete.
3. **Attachments** are stored as `LargeBinary` in the entity; a file-upload UI control is left as a follow-up (the backend validation for the medical certificate already checks `LeaveAttachments`).
4. **Carry-forward** logic is modelled (`eligibleForCarryForward`, `maxCarryForwardDays`) but the year-end roll-over batch job is not included.
5. The UI5 app loads SAPUI5 resources from the CDN (`ui5.sap.com`); for a fully offline Fiori launchpad deployment, bundle UI5 with `ui5 build`.

---

## 12. License

Apache-2.0
