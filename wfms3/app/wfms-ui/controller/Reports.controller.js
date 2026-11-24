sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "wfms/ui/model/formatters"
], function (Controller, MessageToast, MessageBox, formatters) {
    "use strict";
    var ACTION_BASE = "/odata/v4/workforce";
    return Controller.extend("wfms.ui.controller.Reports", {
        formatters: formatters,
        onInit: function () {},
        /** Calls the backend exportPayrollOvertime action and downloads the CSV. */
        onExportPayroll: function () {
            var sFrom = this.byId("otFrom").getValue();
            var sTo = this.byId("otTo").getValue();
            if (!sFrom || !sTo) { MessageBox.error("Select a date range."); return; }
            // OData V4 action: POST /exportPayrollOvertime with JSON body
            fetch(ACTION_BASE + "/exportPayrollOvertime", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ fromDate: sFrom, toDate: sTo })
            }).then(function (r) {
                if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); });
                return r.json();
            }).then(function (o) {
                var sCsv = (o && o.value) || "";
                // trigger a browser download
                var oBlob = new Blob([sCsv], { type: "text/csv;charset=utf-8;" });
                var sUrl = URL.createObjectURL(oBlob);
                var a = document.createElement("a");
                a.href = sUrl;
                a.download = "wfms-payroll-overtime-" + sFrom + "_to_" + sTo + ".csv";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(sUrl);
                MessageToast.show("Payroll CSV exported");
            }).catch(function (e) {
                MessageBox.error("Export failed: " + (e.message || e));
            });
        },
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("hrDashboard", {}, true); }
    });
});
