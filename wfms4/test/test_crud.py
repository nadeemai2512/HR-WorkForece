#!/usr/bin/env python3
"""End-to-end CRUD + action verification for the WFMS CAP backend.

Tests (all against http://localhost:4004/odata/v4/workforce):
  Leave:    create (POST) -> read -> submit action -> approve action -> delete -> 404
  Overtime: create -> submit -> approve
  Function: calcLeaveDays(...)
  Employee: create -> delete   (HRAdmin)
Prints PASS/FAIL per step. Exit code 0 only if all pass.
"""
import json, urllib.request, urllib.error, base64, sys

BASE = "http://localhost:4004/odata/v4/workforce"

def auth(user): return "Basic " + base64.b64encode((user + ":initial").encode()).decode()
def hdrs(user, extra=None):
    h = {"Authorization": auth(user), "Accept": "application/json"}
    if extra: h.update(extra)
    return h

def req(method, path, user, body=None):
    data = None
    h = hdrs(user, {"Content-Type": "application/json"} if body is not None else {})
    if body is not None: data = json.dumps(body).encode()
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try: msg = json.loads(txt).get("error", {}).get("message", txt[:120])
        except: msg = txt[:120]
        return e.code, msg

ALICE = "alice@wfms.com"; BOB = "bob@wfms.com"; CAROL = "carol@wfms.com"
ALICE_ID = "9d47e11c-8e17-5da4-a3a1-d2f643d2f970"
EL_TYPE = "e9c0add9-dc38-5fa1-9184-3d2747706cb7"   # Earned Leave

results = []
def step(name, ok, detail=""):
    results.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not ok else ""))

print("="*64); print("LEAVE LIFECYCLE"); print("="*64)
# 1. create as alice
code, res = req("POST", "/LeaveRequests", ALICE, {
    "employee_ID": ALICE_ID, "leaveType_ID": EL_TYPE,
    "startDate": "2026-12-07", "endDate": "2026-12-08",
    "isHalfDay": False, "reason": "CRUD test leave"
})
lid = res.get("ID") if isinstance(res, dict) else None
step("create LeaveRequest (POST)", code == 201 and lid is not None, f"{code} {res}")
# 2. read it back
code, res = req("GET", f"/LeaveRequests({lid})", ALICE)
step("read created leave (GET)", code == 200, f"{code} {res}")
# 3. submit action
code, res = req("POST", "/submitLeaveRequest", ALICE, {"ID": lid})
step("submitLeaveRequest action", code in (200, 204), f"{code} {res}")
# 4. approve action (try bob=manager, then carol=HRAdmin)
code, res = req("POST", "/approveLeaveRequest", BOB, {"ID": lid, "comments": "Approved - CRUD test", "coverageOverride": False, "coverageOverrideReason": ""})
if code not in (200, 204):
    code, res = req("POST", "/approveLeaveRequest", CAROL, {"ID": lid, "comments": "Approved - CRUD test", "coverageOverride": False, "coverageOverrideReason": ""})
step("approveLeaveRequest action", code in (200, 204), f"{code} {res}")
# 5. verify status changed
code, res = req("GET", f"/LeaveRequests({lid})?$select=status", CAROL)
status = res.get("status") if isinstance(res, dict) else None
step("leave status is Approved", status == "Approved", f"status={status}")
# 6. delete
code, res = req("DELETE", f"/LeaveRequests({lid})", CAROL)
step("delete leave (DELETE)", code in (200, 204), f"{code} {res}")
# 7. confirm gone
code, res = req("GET", f"/LeaveRequests({lid})", CAROL)
step("leave gone after delete (404)", code == 404, f"{code}")

print(); print("="*64); print("OVERTIME LIFECYCLE"); print("="*64)
code, res = req("POST", "/OvertimeRequests", ALICE, {
    "employee_ID": ALICE_ID, "workDate": "2026-12-09",
    "regularShiftStart": None, "regularShiftEnd": None,
    "overtimeStart": "18:00", "overtimeEnd": "20:00",
    "compOffElection": "Pay", "reason": "CRUD test OT"
})
oid = res.get("ID") if isinstance(res, dict) else None
step("create OvertimeRequest (POST)", code == 201 and oid is not None, f"{code} {res}")
if oid:
    code, res = req("POST", "/submitOvertime", ALICE, {"ID": oid})
    step("submitOvertime action", code in (200, 204), f"{code} {res}")
    code, res = req("POST", "/approveOvertime", BOB, {"ID": oid, "comments": "OK"})
    if code not in (200, 204):
        code, res = req("POST", "/approveOvertime", CAROL, {"ID": oid, "comments": "OK"})
    step("approveOvertime action", code in (200, 204), f"{code} {res}")
    code, res = req("GET", f"/OvertimeRequests({oid})?$select=status", CAROL)
    st = res.get("status") if isinstance(res, dict) else None
    step("overtime status Approved", st == "Approved", f"status={st}")
    req("DELETE", f"/OvertimeRequests({oid})", CAROL)

print(); print("="*64); print("FUNCTION CALL"); print("="*64)
url = f"/calcLeaveDays(employee_ID={ALICE_ID},leaveType_ID={EL_TYPE},startDate=2026-12-07,endDate=2026-12-08,isHalfDay=false)"
code, res = req("GET", url, ALICE)
val = res.get("value") if isinstance(res, dict) else None
step("calcLeaveDays function", code == 200 and val is not None, f"{code} {res}")

print(); print("="*64); print("EMPLOYEE CRUD (HRAdmin)"); print("="*64)
DEPT = "876d04ad-e621-5c0e-a8a5-cbc13d5e7a96"  # first department
code, res = req("POST", "/Employees", CAROL, {
    "employeeNumber": "E9999", "firstName": "Test", "lastName": "User",
    "fullName": "Test User", "email": "test.user.crud@wfms.com",
    "department_ID": DEPT, "status": "Active", "employeeCategory": "Permanent",
    "hireDate": "2026-01-01", "country": "IN", "region": "South",
    "hourlyBaseRate": 50
})
eid = res.get("ID") if isinstance(res, dict) else None
step("create Employee (POST)", code == 201 and eid is not None, f"{code} {res}")
if eid:
    # update (PATCH)
    code, res = req("PATCH", f"/Employees({eid})", CAROL, {"firstName": "TestUpdated"})
    step("update Employee (PATCH)", code in (200, 204), f"{code} {res}")
    code, res = req("GET", f"/Employees({eid})?$select=firstName", CAROL)
    fn = res.get("firstName") if isinstance(res, dict) else None
    step("employee name updated", fn == "TestUpdated", f"firstName={fn}")
    code, res = req("DELETE", f"/Employees({eid})", CAROL)
    step("delete Employee (DELETE)", code in (200, 204), f"{code} {res}")

print(); print("="*64)
passed = sum(1 for _,ok in results if ok); total = len(results)
print(f"SUMMARY: {passed}/{total} steps passed")
sys.exit(0 if passed == total else 1)
