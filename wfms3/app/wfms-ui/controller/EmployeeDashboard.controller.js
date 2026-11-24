sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters",
    "wfms/ui/model/odataUtil"
], function (Controller, Filter, FilterOperator, JSONModel, MessageToast, formatters, odataUtil) {
    "use strict";

    return Controller.extend("wfms.ui.controller.EmployeeDashboard", {
        formatters: formatters,

        onInit: function () {
            this._currentEmpId = null;
            var oView = this.getView();
            // JSON model feeding the weekly-hours VizFrame. sap.viz does not
            // support the OData V4 model, so the chart reads from this JSON
            // model populated in _loadWeeklyChart (via odataUtil.readList).
            oView.setModel(new JSONModel({ rows: [] }), "chart");

            // Bind the whole page context to the current employee's EmployeeKPIs row.
            // The KPI virtual fields (availableEL, pendingLeave, weeklyMinutes...)
            // are populated by the backend after-READ handler - no client-side math.
            odataUtil.readList("/EmployeeKPIs", {
                "$top": 1,
                "$select": "ID,employeeNumber,firstName,lastName"
            }).then(function (aRows) {
                if (!aRows || !aRows.length) {
                    MessageToast.show("No employee record found for the current user");
                    return;
                }
                var row = aRows[0];
                this._currentEmpId = row.ID;
                // bind the page to the EmployeeKPIs(ID=...) row so the virtual KPIs resolve
                oView.bindElement({
                    path: "/EmployeeKPIs(ID=" + row.ID + ")",
                    parameters: {
                        "$select": "ID,employeeNumber,availableEL,availableSL,availableCL,availableCO,pendingLeave,approvedLeave,weeklyMinutes,remainingWeeklyMinutes,pendingOvertime,approvedOvertimeMinutes"
                    }
                });
                // refresh the dependent lists filtered to this employee
                var oShifts = oView.byId("upcomingShiftsTable");
                if (oShifts && oShifts.getBinding("items")) {
                    oShifts.getBinding("items").filter(new Filter("employee_ID", FilterOperator.EQ, row.ID));
                }
                var oLeave = oView.byId("recentLeaveTable");
                if (oLeave && oLeave.getBinding("items")) {
                    oLeave.getBinding("items").filter(new Filter("employee_ID", FilterOperator.EQ, row.ID));
                }
                // weekly-hours chart (JSON model, not the V4 list binding)
                this._loadWeeklyChart(row.ID);
                oView.getModel("ui").setProperty("/currentEmployeeNumber", row.employeeNumber);
                oView.getModel("ui").setProperty("/currentEmployeeId", row.ID);
            }.bind(this)).catch(function (err) {
                MessageToast.show("Could not load employee data: " + ((err && err.message) || err));
            });
        },

        /** Load the employee's weekly working-hours feed into the "chart" JSON model. */
        _loadWeeklyChart: function (sEmpId) {
            var oChart = this.getView().getModel("chart");
            odataUtil.readList("/WeeklyHoursView", {
                "$filter": "employee_ID eq " + sEmpId,
                "$select": "workDate,regularMinutes,overtimeMinutes,totalMinutes"
            }).then(function (aRows) {
                oChart.setProperty("/rows", (aRows || []).map(function (r) {
                    var d = r.workDate ? new Date(r.workDate) : null;
                    var sDay = d ? d.toLocaleDateString("en-US", { weekday: "short", day: "2-digit" }) : "";
                    return {
                        day: sDay,
                        regular: Number(r.regularMinutes) || 0,
                        overtime: Number(r.overtimeMinutes) || 0
                    };
                }));
            }).catch(function (err) {
                if (window.console) window.console.warn("[WFMS] weekly chart load failed:", err && err.message);
                oChart.setProperty("/rows", []);
            });
        },

        /* ---- KPI tile click handlers (every tile navigates + applies a filter) ---- */
        onKpiPressLeaveBalance: function () {
            this.getRouter().navTo("leaveList", { query: "all" });
        },
        onKpiPressPendingLeave: function () {
            this.getRouter().navTo("leaveList", { query: "PendingManager" });
        },
        onKpiPressApprovedLeave: function () {
            this.getRouter().navTo("leaveList", { query: "Approved" });
        },
        onKpiPressPendingOvertime: function () {
            this.getRouter().navTo("overtimeList", { query: "PendingManager" });
        },
        onKpiPressApprovedOvertime: function () {
            this.getRouter().navTo("overtimeList", { query: "Approved" });
        },
        onKpiPressSchedule: function () {
            this.getRouter().navTo("shiftSchedule");
        },

        /* ---- Quick actions ---- */
        onApplyLeave: function () { this.getRouter().navTo("leaveCreate"); },
        onSubmitOvertime: function () { this.getRouter().navTo("overtimeCreate"); },
        onRequestSwap: function () { this.getRouter().navTo("shiftSwap"); },
        onViewSchedule: function () { this.getRouter().navTo("shiftSchedule"); },
        onViewHistory: function () { this.getRouter().navTo("leaveList", { query: "all" }); },

        onLeaveItemPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("ID");
            this.getRouter().navTo("leaveDetail", { ID: sId });
        },

        getRouter: function () {
            return this.getOwnerComponent().getRouter();
        }
    });
});
