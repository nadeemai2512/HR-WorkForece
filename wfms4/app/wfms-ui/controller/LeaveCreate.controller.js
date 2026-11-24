sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "wfms/ui/model/odataUtil"
], function (Controller, Filter, FilterOperator, MessageToast, MessageBox, odataUtil) {
    "use strict";

    var ACTION_BASE = "/odata/v4/workforce";

    return Controller.extend("wfms.ui.controller.LeaveCreate", {

        onInit: function () {
            this._currentEmpId = null;
            // resolve current employee once (OData V4 model has no .read; use helper)
            odataUtil.readList("/EmployeeKPIs", {
                "$top": 1,
                "$select": "ID,employeeNumber"
            }).then(function (aRows) {
                if (aRows && aRows.length) {
                    this._currentEmpId = aRows[0].ID;
                    this.getView().getModel("ui").setProperty("/currentEmployeeNumber", aRows[0].employeeNumber);
                }
            }.bind(this)).catch(function (err) {
                if (window.console) window.console.warn("[WFMS] LeaveCreate init:", err && err.message);
            });
        },

        onLeaveTypeChange: function () {
            var sLtId = this.byId("leaveTypeSelect").getSelectedKey();
            // filter the balance preview to the selected leave type for the current employee
            var oBinding = this.byId("balancePreviewTable").getBinding("items");
            var aFilters = [];
            if (this._currentEmpId) {
                aFilters.push(new Filter("employee_ID", FilterOperator.EQ, this._currentEmpId));
            }
            if (sLtId) { aFilters.push(new Filter("leaveType_ID", FilterOperator.EQ, sLtId)); }
            if (oBinding) { oBinding.filter(aFilters); }
            this._previewDays();
        },

        onDateChange: function () {
            this._previewDays();
        },

        /** Live preview of computed working-day count via the OData function calcLeaveDays. */
        _previewDays: function () {
            var sStart = this.byId("startDate").getValue();
            var sEnd = this.byId("endDate").getValue();
            var sLtId = this.byId("leaveTypeSelect").getSelectedKey();
            var bHalf = this.byId("isHalfDay").getSelected();
            if (!sStart || !sEnd || !sLtId || !this._currentEmpId) {
                this.byId("daysPreview").setText("—");
                return;
            }
            // OData V4 function call: GET /calcLeaveDays(employee_ID=...,leaveType_ID=...,startDate=...,endDate=...,isHalfDay=...)
            var sUrl = ACTION_BASE + "/calcLeaveDays(employee_ID=" + this._currentEmpId +
                       ",leaveType_ID=" + sLtId + ",startDate=" + sStart + ",endDate=" + sEnd +
                       ",isHalfDay=" + (bHalf ? "true" : "false") + ")";
            fetch(sUrl, { credentials: "include" })
                .then(function (r) { return r.json(); })
                .then(function (o) {
                    var sDays = o && o.value ? o.value : "—";
                    this.byId("daysPreview").setText(sDays + " day(s)");
                }.bind(this))
                .catch(function () {
                    this.byId("daysPreview").setText("—");
                }.bind(this));
        },

        /** Create the leave request. The backend before-CREATE handler runs all
         *  validations (balance, blackout, advance notice, certificate, overlap)
         *  and computes the working days. On success we either leave as Draft
         *  or call submitLeaveRequest. */
        _create: function (bSubmit) {
            var sLtId = this.byId("leaveTypeSelect").getSelectedKey();
            var sStart = this.byId("startDate").getValue();
            var sEnd = this.byId("endDate").getValue();
            var bHalf = this.byId("isHalfDay").getSelected();
            var sReason = this.byId("reason").getValue();
            if (!sLtId || !sStart || !sEnd) {
                MessageBox.error("Leave type, start and end date are required.");
                return;
            }
            if (new Date(sEnd) < new Date(sStart)) {
                MessageBox.error("End date must be on or after the start date.");
                return;
            }
            if (!this._currentEmpId) {
                MessageBox.error("Could not resolve your employee record. Please reload the page.");
                return;
            }
            var oPayload = {
                employee_ID: this._currentEmpId,
                leaveType_ID: sLtId,
                startDate: sStart,
                endDate: sEnd,
                isHalfDay: bHalf,
                reason: sReason
            };
            var that = this;
            fetch(ACTION_BASE + "/LeaveRequests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(oPayload)
            }).then(function (r) {
                if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); });
                return r.json();
            }).then(function (oCreated) {
                if (bSubmit) {
                    // call submitLeaveRequest action
                    return fetch(ACTION_BASE + "/submitLeaveRequest", {
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
                that.getView().getModel().refresh();
                MessageToast.show(bSubmit ? "Leave request submitted" : "Draft saved");
                that.getOwnerComponent().getRouter().navTo("leaveDetail", { ID: oCreated.ID });
            }).catch(function (e) {
                MessageBox.error("Could not create leave request: " + (e.message || e));
            });
        },

        onSaveDraft: function () { this._create(false); },
        onSubmit: function () { this._create(true); },
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("leaveList", {}, true); }
    });
});
