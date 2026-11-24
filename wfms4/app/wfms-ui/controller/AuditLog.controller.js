sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters"
], function (Controller, Filter, FilterOperator, MessageToast, formatters) {
    "use strict";
    return Controller.extend("wfms.ui.controller.AuditLog", {
        formatters: formatters,
        onInit: function () {},
        onSearch: function () {
            var s = this.byId("searchField").getValue();
            var a = [];
            if (s) {
                a.push(new Filter({ filters: [
                    new Filter("action", FilterOperator.Contains, s),
                    new Filter("entityType", FilterOperator.Contains, s),
                    new Filter("userId", FilterOperator.Contains, s)
                ], and: false }));
            }
            this.byId("auditTable").getBinding("items").filter(a);
        },
        onRefresh: function () { this.getView().getModel().refresh(); MessageToast.show("Refreshed"); },
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("hrDashboard", {}, true); }
    });
});
