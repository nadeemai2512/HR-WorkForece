# WFMS — Workforce Management System (SAPUI5 + SAP CAP, OData V4)

A complete enterprise HR workforce-management application: employees submit leave &
overtime, view shifts/balances, request shift swaps; managers approve/reject with full
policy validation; HR configures policies, holidays, compliance thresholds and exports
reports. Every value on every screen is fetched from the CAP backend — **no hardcoded
KPIs, no dummy data**.

---

## 1. What was broken and what was fixed

The app UI loaded but every dashboard/table/KPI was empty. Root causes (all fixed &
browser-verified):

| # | Root cause | Fix |
|---|---|---|
| 1 | **Empty `db.sqlite`** shipped in the project (0 tables) → every OData GET returned HTTP 500 "no such table". | Ran `cds deploy` to build the full schema (21 `wfms_*` tables + 27 `WorkforceService_*` projection views) and load the 21 CSV seed files. A deployed `db.sqlite` now ships in the ZIP. |
| 2 | **No default OData model.** `manifest.json` declared the OData V4 model under the name `"main"`, but every XML view binds with absolute paths `{/LeaveRequests}` and relative `{availableEL}` (via `bindElement`) — these resolve to the **default (unnamed)** model, which did not exist. So no declarative binding ever fired. | Changed the manifest model key from `"main"` to `""` (the canonical way to declare the default model — it *is* inherited by router-created views). Updated the 15 `getModel("main")` refresh calls in controllers to `getModel()`. |
| 3 | **Chart broke the KPI context binding.** The `VizFrame`'s `FlattenedDataset` bound `data="{chart>/rows}"` but its dimensions/measures used unprefixed `{day}`/`{regular}`/`{overtime}`. Once a default OData model existed, these resolved against the `EmployeeKPIs(ID=…)` OData context and issued invalid `EmployeeKPIs(ID=…)/day` requests, which 404'd and broke the `bindElement` context → all KPI tiles blank. | Prefixed the chart bindings with `{chart>day}` / `{chart>regular}` / `{chart>overtime}`. |
| 4 | **ManagerDashboard `PlanningCalendar` missing template.** `PlanningCalendarRow` bound the `appointments` aggregation (`appointments="{appointments}"`) with no template → "Missing template or factory function for aggregation" once the default model activated it. | Added the `<appointments><PlanningCalendarAppointment …/></appointments>` template and `calendar>` prefixes on all calendar-JSON-model bindings. |
| 5 | **Date `FormatException`.** Views used the v2 `sap.ui.model.type.Date` with the OData V4 model → "The given date instance isn't valid" on every date column. | Replaced with the V4 `sap.ui.model.odata.type.Date` across all 15 views. |
| 6 | **Invalid icon.** `sap-icon://overtime` is not a registered UI5 icon. | Replaced with `sap-icon://time-entry-request` in 5 views. |

Prior fixes from earlier sessions are also present: the `FeedItem` namespace
(`sap.viz.ui5.controls.common.feeds`), `WeeklyHoursView.employee_ID` and
`LeaveBalanceView.leaveType_ID` projections (so the controller `$filter`s resolve).

---

## 2. Prerequisites

- **Node.js 18+** (tested on Node 24)
- **npm**
- A browser (Chrome/Edge/Firefox)

That's all for local dev — SQLite is bundled via `@sap/cds`, UI5 is loaded from the SAP
CDN (`ui5.sap.com`) by `index.html`, so no UI5 tooling install is required.

---

## 3. Install

```bash
unzip wfms.zip -d wfms
cd wfms
npm install            # installs @sap/cds, sqlite3, approuter deps
```

The shipped `db.sqlite` is already deployed (schema + seed data). If you ever want a
fresh database (drops & recreates from the CSV seeds):

```bash
npm run deploy         # = cds deploy
```

---

## 4. Run

```bash
npm start              # = cds-serve  (serves backend AND the UI5 app)
```

`cds-serve` serves **both**:
- the CAP OData V4 service at `http://localhost:4004/odata/v4/workforce`
- the SAPUI5 app at `http://localhost:4004/wfms-ui/index.html`

Open the app in your browser:

```
http://localhost:4004/wfms-ui/index.html
```

The browser will prompt for credentials (HTTP Basic, mocked auth). Use one of the seeded
test users:

| User | Password | Role | Sees |
|------|----------|------|------|
| `alice@wfms.com` | `initial` | Employee (E1001) | own dashboard, leave, overtime, shifts |
| `bob@wfms.com`   | `initial` | Employee + Manager (E1002) | own + team approvals, Manager Dashboard |
| `carol@wfms.com` | `initial` | HRAdmin (E1003) | everything — HR Dashboard, policies, reports, audit |

---

## 5. Verify it works

### 5.1 Backend OData endpoints (every entity returns real data)

```bash
AUTH=$(echo -n 'carol@wfms.com:initial' | base64)
curl -s -H "Authorization: Basic $AUTH" \
  "http://localhost:4004/odata/v4/workforce/Employees?\$top=3&\$select=employeeNumber,fullName"
```

All 27 entity sets (Employees, LeaveRequests, OvertimeRequests, ShiftAssignments,
LeaveBalanceView, WeeklyHoursView, EmployeeKPIs, ManagerKPIs, AuditLogs, …) return 200
with seed data.

### 5.2 CRUD round-trip (create → submit → approve → delete)

A runnable end-to-end test is included in `test/test_crud.py`:

```bash
python3 test/test_crud.py
```

Expected: `16/16 steps passed` — exercises Leave (create/submit/approve/delete),
Overtime (create/submit/approve/delete), Employee (create/patch/delete) and the
`calcLeaveDays` OData function. Records persist across browser refresh and app restart.

### 5.3 Browser smoke test (declarative bindings render real data)

`test/browser_smoke.py` uses Playwright to load each route as the right role and confirm
tables/KPIs render real backend data with no console errors (except harmless
`Component-preload.js` / i18n-locale 404 fallbacks):

```bash
pip install playwright && python3 -m playwright install chromium
python3 test/browser_smoke.py
```

What you should see on the **Employee Dashboard** (real values from the backend):
- Leave balances: EL 20, SL 12, CL 8, CO 0
- Pending leave 1, approved leave, pending overtime, weekly minutes 1920 / remaining 1680
- Weekly-hours bar chart (Regular vs Overtime per day)
- Upcoming shifts + recent leave tables populated

---

## 6. Architecture

```
Browser ──http://localhost:4004/wfms-ui/index.html──▶ SAPUI5 app (XML views/controllers)
                                                            │  default OData V4 model
                                                            │  ({/Entity} + bindElement)
                                                            ▼
CAP Node.js (srv/) ── /odata/v4/workforce ── OData V4 service (27 entity sets, 20 actions/functions)
  service.cds  (projections + actions)                         │
  service.js   (handler registration)                          ▼
  leave/overtime/shift/hr/audit-service.js + lib/        SQLite (db.sqlite, dev) / HANA HDI (prod)
  db/schema.cds (20 entities) + db/data/*.csv (21 seed files)
```

Model configuration (`app/wfms-ui/manifest.json`):
- `sap.app.dataSources.main` → `/odata/v4/workforce/` (OData V4)
- `sap.ui5.models[""]` → the **default** OData V4 model (the key fix — views use
  unprefixed `{/…}` bindings)
- `sap.ui5.models.i18n` → resource bundle

Imperative reads/writes that can't go through declarative bindings (KPI counts, chart
data, create/approve actions) use `model/odataUtil.js` (Promise wrappers over `fetch`
sharing the browser's authenticated session).

---

## 7. Modules

All 15 modules bind to real backend data:
Employee Dashboard · Manager Dashboard · HR Dashboard · Leave List/Create/Detail ·
Overtime List/Create/Detail · Shift Schedule · Shift Swap · Approval Inbox ·
Employee Management/Detail · Policy Configuration · Reports · Audit Log.

Production deployment to SAP BTP uses the `mta.yaml` (HDI container, XSUAA, approuter,
CAP nodejs) — the same code, with `cds` `[production]` config switching SQLite→HANA and
mocked auth→XSUAA.

---

## 8. Notes

- The only console messages are `Component-preload.js` 404 and `i18n_en*.properties` 404
  (UI5's normal dev fallback to `Component.js` and `i18n.properties`) — harmless.
- `npm run deploy` rebuilds `db.sqlite` from the CSV seeds (drops existing data).
- To pin a UI5 version, change the `src` in `index.html` to a versioned CDN URL
  (e.g. `https://ui5.sap.com/1.120.0/resources/sap-ui-core.js`).
