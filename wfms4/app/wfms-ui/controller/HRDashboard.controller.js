sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters",
    "wfms/ui/model/odataUtil"
], function (Controller, MessageToast, formatters, odataUtil) {
    "use strict";

    return Controller.extend("wfms.ui.controller.HRDashboard", {
        formatters: formatters,

        onInit: function () {
            // HR KPI tiles bind to {ui>/<count>} properties. The UI5 OData V4
            // model cannot bind a property directly to /EntitySet/$count, so
            // every count is resolved here via /EntitySet/$count (with an
            // optional $filter) and pushed onto the lightweight "ui" JSON model.
            var oUI = this.getView().getModel("ui");
            var aCounts = [
                { prop: "empCount",        set: "Employees" },
                { prop: "activeEmployees", set: "Employees", filter: "status eq 'Active'" },
                { prop: "deptCount",       set: "Departments" },
                { prop: "leaveTypeCount",  set: "LeaveTypes" },
                { prop: "shiftTmplCount",  set: "ShiftTemplates" },
                { prop: "complianceCount", set: "ComplianceRules" },
                { prop: "holidayCount",    set: "CompanyHolidays" },
                { prop: "auditCount",      set: "AuditLogs" }
            ];
            aCounts.forEach(function (o) {
                odataUtil.count(o.set, o.filter).then(function (n) {
                    oUI.setProperty("/" + o.prop, n);
                }).catch(function (err) {
                    if (window.console) window.console.warn("[WFMS] count " + o.set + " failed:", err && err.message);
                    oUI.setProperty("/" + o.prop, 0);
                });
            });
        },

        onCreateEmployee: function () { this.getRouter().navTo("employeeManage", {}, true); },
        onNavEmployees: function () { this.getRouter().navTo("employeeManage", {}, true); },
        onNavPolicies: function () { this.getRouter().navTo("policyConfig", {}, true); },
        onNavShifts: function () { this.getRouter().navTo("shiftSchedule", {}, true); },
        onNavReports: function () { this.getRouter().navTo("reports", {}, true); },
        onNavAudit: function () { this.getRouter().navTo("auditLog", {}, true); },

        getRouter: function () { return this.getOwnerComponent().getRouter(); }
    });
});
