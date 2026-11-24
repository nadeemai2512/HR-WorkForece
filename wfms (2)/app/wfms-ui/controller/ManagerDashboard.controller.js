sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters",
    "wfms/ui/model/odataUtil"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast, formatters, odataUtil) {
    "use strict";

    var ACTION_BASE = "/odata/v4/workforce";

    return Controller.extend("wfms.ui.controller.ManagerDashboard", {
        formatters: formatters,

        onInit: function () {
            this._managerId = null;
            // JSON model feeding the PlanningCalendar (employees -> appointments).
            this.getView().setModel(new JSONModel({ rows: [], today: new Date() }), "calendar");
            this._initManager();
        },

        _initManager: function () {
            var oView = this.getView();
            // The current user resolves to a ManagerKPIs row (the manager's own
            // Employees row, projected). We bind the page to it so the virtual
            // team KPIs resolve from the backend after-READ handler.
            odataUtil.readList("/ManagerKPIs", {
                "$top": 1,
                "$select": "ID,employeeNumber,fullName,teamMembers,presentToday,onLeaveToday,pendingLeaveApprovals,pendingOvertimeApprovals,pendingSwapRequests,staffingPct,complianceAlerts"
            }).then(function (aRows) {
                if (!aRows || !aRows.length) {
                    MessageToast.show("No manager record found for the current user");
                    return;
                }
                var row = aRows[0];
                this._managerId = row.ID;
                oView.bindElement({
                    path: "/ManagerKPIs(ID=" + row.ID + ")",
                    parameters: {
                        "$select": "ID,employeeNumber,fullName,teamMembers,presentToday,onLeaveToday,pendingLeaveApprovals,pendingOvertimeApprovals,pendingSwapRequests,staffingPct,complianceAlerts"
                    }
                });
                this._loadTeamCalendar(row.ID);
                this._filterApprovalTables();
            }.bind(this)).catch(function (err) {
                MessageToast.show("Could not load manager dashboard: " + ((err && err.message) || err));
            });
        },

        /** Load the manager's team + their shifts/approved leave into the calendar JSON model. */
        _loadTeamCalendar: function (sManagerId) {
            var oCal = this.getView().getModel("calendar");
            // 1. direct reports
            odataUtil.readList("/Employees", {
                "$filter": "manager_ID eq " + sManagerId,
                "$select": "ID,employeeNumber,fullName"
            }).then(function (aEmps) {
                var aRows = aEmps.map(function (e) {
                    return { key: e.ID, title: e.fullName, appointments: [], intervalHeaders: [] };
                });
                oCal.setProperty("/rows", aRows);
                if (!aEmps.length) { return; }
                var sEmpFilter = aEmps.map(function (e) { return "employee_ID eq " + e.ID; }).join(" or ");
                // 2. shifts + 3. approved leave, fetched in parallel
                var pShifts = odataUtil.readList("/ShiftAssignments", {
                    "$filter": sEmpFilter,
                    "$expand": "shiftTemplate",
                    "$select": "ID,employee_ID,assignmentDate,startTime,endTime,status,shiftTemplate_ID"
                });
                var pLeave = odataUtil.readList("/LeaveRequests", {
                    "$filter": sEmpFilter + " and status eq 'Approved'",
                    "$select": "ID,employee_ID,startDate,endDate,status"
                });
                return Promise.all([pShifts, pLeave]).then(function (aResults) {
                    var aShifts = aResults[0] || [];
                    var aLeave = aResults[1] || [];
                    aShifts.forEach(function (s) {
                        var oRow = aRows.find(function (r) { return r.key === s.employee_ID; });
                        if (!oRow) return;
                        var sDate = s.assignmentDate; // "YYYY-MM-DD"
                        oRow.appointments.push({
                            key: s.ID,
                            title: "Shift " + (s.status || ""),
                            type: s.status === "Confirmed" ? "Type09" : "Type01",
                            startDate: sDate + "T" + (s.startTime || "09:00") + ":00",
                            endDate: sDate + "T" + (s.endTime || "18:00") + ":00"
                        });
                    });
                    aLeave.forEach(function (l) {
                        var oRow = aRows.find(function (r) { return r.key === l.employee_ID; });
                        if (!oRow) return;
                        oRow.appointments.push({
                            key: "leave-" + l.ID,
                            title: "On Leave",
                            type: "Type06",
                            startDate: l.startDate + "T00:00:00",
                            endDate: l.endDate + "T23:59:59"
                        });
                    });
                    oCal.setProperty("/rows", aRows);
                });
            }.bind(this)).catch(function (err) {
                if (window.console) window.console.warn("[WFMS] Team calendar load failed:", err && err.message);
            });
        },

        _filterApprovalTables: function () {
            // Pending leave + overtime + swap approvals for the manager's team.
            // We use a broad filter on status and let instance authorization scope it.
            var oView = this.getView();
            var oLeaveTbl = oView.byId("leaveApprovalTable");
            if (oLeaveTbl && oLeaveTbl.getBinding("items")) oLeaveTbl.getBinding("items").filter(new Filter("status", FilterOperator.EQ, "PendingManager"));
            var oOtTbl = oView.byId("overtimeApprovalTable");
            if (oOtTbl && oOtTbl.getBinding("items")) oOtTbl.getBinding("items").filter(new Filter("status", FilterOperator.EQ, "PendingManager"));
            var oSwapTbl = oView.byId("swapApprovalTable");
            if (oSwapTbl && oSwapTbl.getBinding("items")) oSwapTbl.getBinding("items").filter(new Filter("status", FilterOperator.EQ, "PendingManager"));
        },

        /* ---- KPI tile clicks ---- */
        onKpiPressTeam: function () { this.getRouter().navTo("employeeManage"); },
        onKpiPressLeaveApprovals: function () { this.getRouter().navTo("approvalInbox", { type: "leave" }); },
        onKpiPressOvertimeApprovals: function () { this.getRouter().navTo("approvalInbox", { type: "overtime" }); },
        onKpiPressSwapApprovals: function () { this.getRouter().navTo("approvalInbox", { type: "swap" }); },
        onKpiPressCompliance: function () { this.getRouter().navTo("reports"); },

        onApprovalTabSelect: function () {},

        /* ---- Approve / Reject (call OData V4 unbound actions via fetch) ---- */
        _callAction: function (sAction, oPayload, sSuccessMsg) {
            return fetch(ACTION_BASE + "/" + sAction, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(oPayload)
            }).then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (e) { throw new Error(e && e.error ? e.error.message : r.statusText); });
                }
                return r.json();
            }).then(function () {
                MessageToast.show(sSuccessMsg);
                // refresh the model so approval tables + KPIs re-read from the backend
                this.getView().getModel("main").refresh();
                this._initManager();
            }.bind(this)).catch(function (e) {
                MessageBox.error("Action failed: " + (e.message || e));
            });
        },

        onApproveLeave: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext();
            var sId = oCtx.getProperty("ID");
            MessageBox.confirm(this.getView().getModel("i18n").getResourceBundle().getText("msgConfirmApprove"), {
                title: "Approve Leave",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;
                    this._callAction("approveLeaveRequest",
                        { ID: sId, comments: "Approved via manager dashboard", coverageOverride: false, coverageOverrideReason: "" },
                        this.getView().getModel("i18n").getResourceBundle().getText("msgLeaveApproved"));
                }.bind(this)
            });
        },
        onRejectLeave: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("ID");
            this._callAction("rejectLeaveRequest", { ID: sId, comments: "Rejected via manager dashboard" }, "Leave request rejected");
        },

        onApproveOvertime: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("ID");
            this._callAction("approveOvertime", { ID: sId, comments: "Approved via manager dashboard" }, "Overtime approved");
        },
        onRejectOvertime: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("ID");
            this._callAction("rejectOvertime", { ID: sId, comments: "Rejected via manager dashboard" }, "Overtime rejected");
        },

        onApproveSwap: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("ID");
            this._callAction("approveShiftSwap", { ID: sId, comments: "Approved via manager dashboard" }, "Shift swap approved");
        },
        onRejectSwap: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("ID");
            this._callAction("rejectShiftSwap", { ID: sId, comments: "Rejected via manager dashboard" }, "Shift swap rejected");
        },

        onAppointmentSelect: function (oEvent) {
            var oAppt = oEvent.getParameter("appointment");
            if (oAppt) MessageToast.show(oAppt.getTitle());
        },

        getRouter: function () { return this.getOwnerComponent().getRouter(); }
    });
});
