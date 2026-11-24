sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function (JSONModel, Device) {
    "use strict";

    return {
        createDeviceModel: function () {
            var oModel = new JSONModel(Device);
            oModel.setDefaultBindingMode("OneWay");
            return oModel;
        },

        /** UI state: current user identity, active role, filter state for dashboards. */
        createUIStateModel: function () {
            // The CAP mock auth sets req.user.id = email; in a deployed XSUAA scenario
            // the JWT email maps to the Employees row. We resolve the current employee
            // at runtime via the EmployeeKPIs endpoint (filtered by email), so the UI
            // never hardcodes a user.
            return new JSONModel({
                currentUserEmail: "",
                currentEmployeeId: "",
                currentEmployeeNumber: "",
                currentRole: "Employee", // Employee | Manager | HRAdmin
                leaveListFilter: "",
                overtimeListFilter: "",
                approvalType: "leave",
                busy: false
            });
        }
    };
});
