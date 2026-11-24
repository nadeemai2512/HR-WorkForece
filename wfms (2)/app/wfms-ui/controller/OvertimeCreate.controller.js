sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "wfms/ui/model/odataUtil"
], function (Controller, MessageToast, MessageBox, odataUtil) {
    "use strict";

    var ACTION_BASE = "/odata/v4/workforce";

    return Controller.extend("wfms.ui.controller.OvertimeCreate", {

        onInit: function () {
            this._currentEmpId = null;
            odataUtil.readList("/EmployeeKPIs", {
                "$top": 1,
                "$select": "ID,employeeNumber"
            }).then(function (aRows) {
                if (aRows && aRows.length) {
                    this._currentEmpId = aRows[0].ID;
                    this.getView().getModel("ui").setProperty("/currentEmployeeNumber", aRows[0].employeeNumber);
                }
            }.bind(this)).catch(function (err) {
                if (window.console) window.console.warn("[WFMS] OvertimeCreate init:", err && err.message);
            });
        },

        /** Live preview via the OData function calcOvertime (backend computes type/multiplier/amount/compoff). */
        onPreview: function () {
            var sDate = this.byId("workDate").getValue();
            var sStart = this.byId("otStart").getValue();
            var sEnd = this.byId("otEnd").getValue();
            if (!sDate || !sStart || !sEnd || !this._currentEmpId) return;
            var sUrl = ACTION_BASE + "/calcOvertime(employee_ID=" + this._currentEmpId +
                       ",workDate=" + sDate + ",otStart='" + sStart + "',otEnd='" + sEnd + "')";
            fetch(sUrl, { credentials: "include" })
                .then(function (r) { return r.json(); })
                .then(function (o) {
                    if (!o || !o.value) return;
                    var d = JSON.parse(o.value);
                    this.byId("prevType").setText(d.type);
                    this.byId("prevMinutes").setText(d.minutes + " min (" + d.hours + "h)");
                    this.byId("prevMultiplier").setText(d.multiplier + "x");
                    this.byId("prevRate").setText("₹ " + d.baseHourlyRate);
                    this.byId("prevAmount").setText("₹ " + d.estimatedAmount);
                    this.byId("prevCompOff").setText(d.compOffCredits + " credits");
                }.bind(this))
                .catch(function () {});
        },

        _create: function (bSubmit) {
            var sDate = this.byId("workDate").getValue();
            var sStart = this.byId("otStart").getValue();
            var sEnd = this.byId("otEnd").getValue();
            var sCompOff = this.byId("compOffElection").getSelectedKey();
            var sReason = this.byId("reason").getValue();
            if (!sDate || !sStart || !sEnd) { MessageBox.error("Work date and overtime start/end are required."); return; }
            var oPayload = {
                employee_ID: this._currentEmpId,
                workDate: sDate,
                regularShiftStart: this.byId("regStart").getValue() || null,
                regularShiftEnd: this.byId("regEnd").getValue() || null,
                overtimeStart: sStart,
                overtimeEnd: sEnd,
                compOffElection: sCompOff,
                reason: sReason
            };
            var that = this;
            fetch(ACTION_BASE + "/OvertimeRequests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(oPayload)
            }).then(function (r) {
                if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); });
                return r.json();
            }).then(function (oCreated) {
                if (bSubmit) {
                    return fetch(ACTION_BASE + "/submitOvertime", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ ID: oCreated.ID })
                    }).then(function (rs) {
                        if (!rs.ok) return rs.json().then(function (e) { throw new Error(e.error && e.error.message || rs.statusText); });
                        return oCreated;
                    });
                }
                return oCreated;
            }).then(function (oCreated) {
                that.getView().getModel("main").refresh();
                MessageToast.show(bSubmit ? "Overtime submitted" : "Draft saved");
                that.getOwnerComponent().getRouter().navTo("overtimeDetail", { ID: oCreated.ID });
            }).catch(function (e) {
                MessageBox.error("Could not create overtime request: " + (e.message || e));
            });
        },

        onSaveDraft: function () { this._create(false); },
        onSubmit: function () { this._create(true); },
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("overtimeList", {}, true); }
    });
});
