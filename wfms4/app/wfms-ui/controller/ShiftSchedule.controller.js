sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters"
], function (Controller, Filter, FilterOperator, MessageToast, formatters) {
    "use strict";
    return Controller.extend("wfms.ui.controller.ShiftSchedule", {
        formatters: formatters,
        onInit: function () {},
        onFilterChange: function () {
            var aFilters = [];
            var sEmp = this.byId("empFilter").getSelectedKey();
            var sTpl = this.byId("tplFilter").getSelectedKey();
            if (sEmp) aFilters.push(new Filter("employee_ID", FilterOperator.EQ, sEmp));
            if (sTpl) aFilters.push(new Filter("shiftTemplate_ID", FilterOperator.EQ, sTpl));
            this.byId("shiftTable").getBinding("items").filter(aFilters);
        },
        onRefresh: function () { this.getView().getModel().refresh(); MessageToast.show("Refreshed"); },
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("employeeDashboard", {}, true); }
    });
});
