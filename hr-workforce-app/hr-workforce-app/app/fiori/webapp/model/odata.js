sap.ui.define([
  "sap/base/Log"
], function (Log) {
  "use strict";

  /**
   * odata.js — thin helpers around the OData V4 model for actions / functions
   * and JSON export. CRUD itself uses standard list/context bindings; this only
   * wraps the operations that are awkward in declarative bindings.
   */

  /** Resolve the absolute base URL of the OData service from the manifest. */
  function _serviceUrl(oComponent) {
    var oManifest = oComponent.getManifestObject();
    var sUri = oManifest["sap.app"].dataSources.mainService.uri;
    if (sUri.charAt(0) === "/") {
      return window.location.origin + sUri;
    }
    return sUri;
  }

  /** Read the CSRF token required for non-GET requests, from the model headers. */
  function _csrfToken(oModel) {
    var oHeaders = oModel.getHttpHeaders ? oModel.getHttpHeaders() : {};
    return oHeaders["x-csrf-token"] || "fetch";
  }

  /**
   * Call an OData V4 function import or bound action.
   * @param {object} oComponent component instance (for service URL)
   * @param {string} sPath      path relative to service root, e.g.
   *                            "calculateLeaveDays(employeeNo='E1003',leaveTypeCode='EL',startDate=2026-12-01,endDate=2026-12-03)"
   *                            or "LeaveRequests(ID=...)/approve(comment='ok')"
   * @param {string} sMethod    GET (function) or POST (action)
   * @param {object} oBody      JSON body for POST actions
   * @returns {Promise<object>} the parsed response value
   */
  function callOperation(oComponent, sPath, sMethod, oBody) {
    var sUrl = _serviceUrl(oComponent) + sPath;
    var oModel = oComponent.getModel();
    var oHeaders = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": _csrfToken(oModel)
    };
    var oInit = { method: sMethod || "GET", headers: oHeaders, credentials: "same-origin" };
    if (oBody && (sMethod || "GET") !== "GET") {
      oInit.body = JSON.stringify(oBody);
    }
    return fetch(sUrl + (sUrl.indexOf("$format") === -1 && sMethod !== "POST" ? "?$format=json" : ""), oInit)
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(function (err) {
            var msg = (err && err.error && err.error.message) || r.statusText;
            throw new Error(msg);
          });
        }
        return r.json();
      })
      .then(function (oData) {
        return oData && oData.value !== undefined ? oData.value : oData;
      })
      .catch(function (e) {
        Log.error("OData operation failed: " + sPath, e && e.message);
        throw e;
      });
  }

  /** POST a bound action with a single String parameter. */
  function callAction(oComponent, sEntityPath, sAction, sParamName, sParamValue) {
    var sParam = "";
    if (sParamName) {
      sParam = "(" + sParamName + "='" + encodeURIComponent(sParamValue || "") + "')";
    }
    return callOperation(oComponent, sEntityPath + "/" + sAction + sParam, "POST", null);
  }

  /**
   * Trigger a client-side CSV/Excel export from an array of plain rows.
   * Backend-provided data is the source; this only serialises it.
   */
  function exportToCsv(sFileName, aColumns, aRows) {
    var sContent = aColumns.join(",") + "\n";
    aRows.forEach(function (oRow) {
      sContent += aColumns.map(function (sCol) {
        var v = oRow[sCol];
        if (v == null) v = "";
        v = String(v).replace(/"/g, '""');
        return /[",\n]/.test(v) ? '"' + v + '"' : v;
      }).join(",") + "\n";
    });
    var oBlob = new Blob([sContent], { type: "text/csv;charset=utf-8;" });
    var oLink = document.createElement("a");
    oLink.href = URL.createObjectURL(oBlob);
    oLink.download = sFileName;
    oLink.click();
  }

  return {
    callOperation: callOperation,
    callAction: callAction,
    exportToCsv: exportToCsv
  };
});
