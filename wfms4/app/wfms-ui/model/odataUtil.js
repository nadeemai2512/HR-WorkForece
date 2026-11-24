/**
 * wfms/ui/model/odataUtil.js
 *
 * Promise-based helpers for one-shot reads AND writes against the OData V4
 * service. The SAPUI5 OData V4 model (sap.ui.model.odata.v4.ODataModel)
 * is binding-centric and has no v2-style read(success,error) method, so the
 * dashboard / create / detail controllers use these helpers (which go
 * directly through fetch, sharing the browser's authenticated session) for
 * values they must resolve imperatively.
 *
 * The CAP OData V4 adapter in this project does NOT enforce CSRF tokens on
 * modifying requests (verified against cds v10.2.2), so the write helpers
 * only need credentials + Content-Type. All declarative list / table / form
 * bindings in the XML views still bind through the "main" OData V4 model
 * declared in manifest.json.
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

    /** Normalize a failed fetch response into an Error carrying the OData message. */
    function toError(r) {
        return r.json().then(function (e) {
            var msg = (e && e.error && e.error.message) || r.statusText || ("HTTP " + r.status);
            var err = new Error(msg);
            err.status = r.status;
            return err;
        }, function () { var e2 = new Error(r.statusText || ("HTTP " + r.status)); e2.status = r.status; return e2; });
    }

    /** Read a collection. Returns a Promise resolving to the value array. */
    function readList(sPath, mParams) {
        return fetch(ACTION_BASE + sPath + buildQuery(mParams), { credentials: "include" })
            .then(function (r) { if (!r.ok) return toError(r).then(Promise.reject); return r.json(); })
            .then(function (oData) { return (oData && oData.value) || []; });
    }

    /** Read a single entity by its canonical path, e.g. "/Employees(ID=...)". Returns Promise<object>. */
    function readOne(sPath) {
        return fetch(ACTION_BASE + sPath, { credentials: "include" })
            .then(function (r) { if (!r.ok) return toError(r).then(Promise.reject); return r.json(); });
    }

    /** GET /EntitySet/$count, optionally with an OData $filter. Returns Promise<number>. */
    function count(sEntitySet, sFilter) {
        var sUrl = ACTION_BASE + "/" + sEntitySet + "/$count";
        if (sFilter) { sUrl += "?$filter=" + encodeURIComponent(sFilter); }
        return fetch(sUrl, { credentials: "include" })
            .then(function (r) { if (!r.ok) return toError(r).then(Promise.reject); return r.text(); })
            .then(function (sText) { return parseInt(sText, 10) || 0; });
    }

    /**
     * Create an entity. Returns a Promise resolving to the created object.
     * @param {string} sEntitySet e.g. "Employees"
     * @param {object} oData      property bag (use _ID FK names for associations)
     */
    function create(sEntitySet, oData) {
        return fetch(ACTION_BASE + "/" + sEntitySet, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(oData)
        }).then(function (r) { if (!r.ok) return toError(r).then(Promise.reject); return r.json(); })
          .then(function (o) { return (o && o.value !== undefined) ? o.value : o; });
    }

    /**
     * Update an entity via PATCH. Returns a Promise resolving when updated.
     * @param {string} sEntitySet e.g. "Employees"
     * @param {string} sId         raw key value (UUID)
     * @param {object} oData       properties to change
     */
    function update(sEntitySet, sId, oData) {
        return fetch(ACTION_BASE + "/" + sEntitySet + "(" + sId + ")", {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(oData)
        }).then(function (r) { if (!r.ok) return toError(r).then(Promise.reject); return r.status === 204 ? null : r.json(); });
    }

    /**
     * Delete an entity via DELETE. Returns a Promise resolving when deleted.
     * @param {string} sEntitySet e.g. "Employees"
     * @param {string} sId         raw key value (UUID)
     */
    function remove(sEntitySet, sId) {
        return fetch(ACTION_BASE + "/" + sEntitySet + "(" + sId + ")", {
            method: "DELETE",
            credentials: "include",
            headers: { Accept: "application/json" }
        }).then(function (r) { if (!r.ok) return toError(r).then(Promise.reject); return null; });
    }

    /**
     * Invoke an UNBOUND service action/function. For actions (POST) the
     * parameters go in the JSON body; for functions a GET is used (pass
     * mParams). Returns a Promise resolving to the action result.
     * @param {string} sAction e.g. "approveLeaveRequest"
     * @param {object} oParams parameter bag (omitted for parameterless calls)
     */
    function callAction(sAction, oParams) {
        return fetch(ACTION_BASE + "/" + sAction, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(oParams || {})
        }).then(function (r) { if (!r.ok) return toError(r).then(Promise.reject); return r.json(); })
          .then(function (o) { return (o && o.value !== undefined) ? o.value : o; });
    }

    return {
        ACTION_BASE: ACTION_BASE,
        buildQuery: buildQuery,
        readList: readList,
        readOne: readOne,
        count: count,
        create: create,
        update: update,
        remove: remove,
        callAction: callAction
    };
});
