sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/Device",
    "wfms/ui/model/odataUtil"
], function (Controller, JSONModel, MessageToast, Device, odataUtil) {
    "use strict";

    return Controller.extend("wfms.ui.controller.App", {

        onInit: function () {
            // Resolve the current user from the authenticated session. In mock auth
            // the CAP server scopes /EmployeeKPIs to req.user; in production XSUAA
            // the JWT email maps to the Employees row. We read the first KPI row the
            // server allows and derive the current employee number from it. Role is
            // only a client-side hint for nav visibility - the backend enforces
            // authorization independently of this value.
            this._resolveCurrentUser();
        },

        _resolveCurrentUser: function () {
            var oUI = this.getView().getModel("ui");
            // The OData V4 model has no v2-style read(success,error); use the
            // fetch-based helper which shares the browser's authenticated session.
            odataUtil.readList("/EmployeeKPIs", {
                "$top": 1,
                "$select": "ID,employeeNumber,firstName,lastName,email"
            }).then(function (aRows) {
                if (aRows && aRows.length) {
                    var row = aRows[0];
                    oUI.setProperty("/currentEmployeeNumber", row.employeeNumber);
                    oUI.setProperty("/currentEmployeeId", row.ID);
                    oUI.setProperty("/currentRole", "Employee");
                }
            }.bind(this)).catch(function (err) {
                // Non-fatal: shell still renders. Dashboards surface their own errors.
                if (window.console) {
                    window.console.warn("[WFMS] Could not resolve current user:", err && err.message);
                }
            });
        },

        onSideNavButtonPress: function () {
            var oToolPage = this.byId("toolPage");
            var bSideExpanded = oToolPage.getSideExpanded();
            this._setSideExpanded(!bSideExpanded);
        },

        _setSideExpanded: function (bExpanded) {
            this.byId("toolPage").setSideExpanded(bExpanded);
        },

        onItemSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            var sKey = oItem.getKey();
            this.getRouter().navTo(sKey, {}, true);
        },

        onUserProfilePress: function () {
            MessageToast.show("Current user: " + this.getView().getModel("ui").getProperty("/currentEmployeeNumber"));
        },

        getRouter: function () {
            return this.getOwnerComponent().getRouter();
        }
    });
});
