/**
 * wfms/ui/model/odataUtil.js
 *
 * Small promise-based helpers for one-shot reads against the OData V4
 * service. The SAPUI5 OData V4 model (sap.ui.model.odata.v4.ODataModel)
 * is binding-centric and has NO v2-style read(success,error) method,
 * so the dashboard / create controllers use these helpers (which go
 * directly through fetch, sharing the browser's authenticated session)
 * for the handful of values they need to resolve imperatively:
 *   - the current employee (EmployeeKPIs)
 *   - the manager's team + their shifts/leave for the PlanningCalendar
 *   - filtered counts for HR KPI tiles
 *
 * All declarative list / table / form bindings in the XML views still
 * bind through the "main" OData V4 model declared in manifest.json.
 */
sap.ui.define([], function () {
    "use strict";

    var ACTION_BASE = "/odata/v4/workforce";

    /** Turn { $top:1, $select:"a,b" } into "?$top=1&$select=a%2Cb". */
    function buildQuery(mParams) {
        if (!mParams) { return ""; }
        var aParts = [];
        Object.keys(mParams).forEach(function (sKey) {
            var sName = sKey.replace(/^\$/, "");
            var vVal = mParams[sKey];
            if (vVal == null || vVal === "") { return; }
            aParts.push("$" + sName + "=" + encodeURIComponent(String(vVal)));
        });
        return aParts.length ? ("?" + aParts.join("&")) : "";
    }

    /** Read a collection. Returns a Promise resolving to the value array. */
    function readList(sPath, mParams) {
        return fetch(ACTION_BASE + sPath + buildQuery(mParams), { credentials: "include" })
            .then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (e) {
                        throw new Error((e && e.error && e.error.message) || r.statusText);
                    }, function () { throw new Error(r.statusText); });
                }
                return r.json();
            })
            .then(function (oData) { return (oData && oData.value) || []; });
    }

    /** Read a single entity by its canonical path, e.g. "/Employees(ID=...)". Returns Promise<object>. */
    function readOne(sPath) {
        return fetch(ACTION_BASE + sPath, { credentials: "include" })
            .then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (e) {
                        throw new Error((e && e.error && e.error.message) || r.statusText);
                    }, function () { throw new Error(r.statusText); });
                }
                return r.json();
            });
    }

    /** GET /EntitySet/$count, optionally with an OData $filter. Returns Promise<number>. */
    function count(sEntitySet, sFilter) {
        var sUrl = ACTION_BASE + "/" + sEntitySet + "/$count";
        if (sFilter) { sUrl += "?$filter=" + encodeURIComponent(sFilter); }
        return fetch(sUrl, { credentials: "include" })
            .then(function (r) {
                if (!r.ok) { throw new Error(r.statusText); }
                return r.text();
            })
            .then(function (sText) { return parseInt(sText, 10) || 0; });
    }

    return {
        ACTION_BASE: ACTION_BASE,
        buildQuery: buildQuery,
        readList: readList,
        readOne: readOne,
        count: count
    };
});
