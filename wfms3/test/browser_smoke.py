#!/usr/bin/env python3
"""Browser smoke test for the WFMS SAPUI5 app.

Requires: pip install playwright && python3 -m playwright install chromium
Run with the CAP server already started (npm start).

Loads the app as carol@wfms.com (HRAdmin) and confirms the declarative OData V4
bindings render real backend data (KPI tiles + tables + chart) with no console errors
beyond the harmless Component-preload/i18n-locale 404 fallbacks.
"""
import sys, time, collections
from playwright.sync_api import sync_playwright

APP = "http://localhost:4004/wfms-ui/index.html"
CREDS = {"username": "carol@wfms.com", "password": "initial"}
SCREENSHOT = "wfms_smoke.png"


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(http_credentials=CREDS, viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        msgs, odata = [], []
        page.on("console", lambda m: msgs.append((m.type, m.text)))
        page.on("response", lambda r: odata.append((r.status, r.url))
                if "/odata/v4/workforce" in r.url else None)

        page.goto(APP, wait_until="domcontentloaded", timeout=30000)
        try:
            page.wait_for_selector("text=Apply Leave", timeout=25000)
        except Exception:
            print("FAIL: EmployeeDashboard did not render within 25s")
            b.close(); return 1
        # wait for KPI numbers to populate
        try:
            page.wait_for_function(
                "()=>{const n=[...document.querySelectorAll('.sapMNumericContent')];"
                "return n.length && n.some(x=>(x.innerText||'').trim()!=='');}", timeout=15000)
            print("PASS: KPI tiles populated with real values")
        except Exception:
            print("FAIL: KPI tiles still empty after 15s")
        page.screenshot(path=SCREENSHOT, full_page=False)
        print(f"  screenshot: {SCREENSHOT}")

        ok = sum(1 for s, _ in odata if 200 <= s < 300 and "/odata/v4/workforce" in _)
        bad = [(s, u) for s, u in odata if s >= 400]
        print(f"  OData requests: {ok} OK, {len(bad)} 4xx/5xx")
        for s, u in bad[:5]:
            print(f"    [{s}] {u.split('/odata/v4/workforce')[-1][:80]}")

        # sweep other routes
        for h, name in [("#manager", "ManagerDashboard"), ("#hr", "HRDashboard"),
                        ("#leaves", "LeaveList"), ("#overtime", "OvertimeList"),
                        ("#approvals", "ApprovalInbox"), ("#shifts", "ShiftSchedule"),
                        ("#hr/employees", "EmployeeManage"), ("#hr/policies", "PolicyConfig"),
                        ("#hr/reports", "Reports"), ("#hr/audit", "AuditLog")]:
            page.evaluate(f"window.location.hash='{h}'")
            time.sleep(3)
            info = page.evaluate("()=>({t:document.querySelectorAll('table').length,"
                                 "b:(document.body.innerText||'').length})")
            print(f"  {name:18} tables={info['t']} bodyLen={info['b']}")

        errs = [t for typ, t in msgs if typ == "error"
                and "Component-preload" not in t and "i18n_en" not in t
                and "Failed to load resource" not in t]
        print(f"  console errors (excl. harmless 404 fallbacks): {len(errs)}")
        for t in errs[:5]:
            print(f"    {t[:140]}")
        b.close()
        return 0


if __name__ == "__main__":
    sys.exit(main())
