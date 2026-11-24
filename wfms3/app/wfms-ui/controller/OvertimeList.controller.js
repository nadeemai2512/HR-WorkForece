sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters"
], function (Controller, Filter, FilterOperator, MessageToast, formatters) {
    "use strict";

    return Controller.extend("wfms.ui.controller.OvertimeList", {
        formatters: formatters,
        onInit: function () {
            this._oRouter = this.getOwnerComponent().getRouter();
            this._oRouter.getRoute("overtimeList").attachPatternMatched(this._onRouteMatched, this);
        },
        _onRouteMatched: function (oEvent) {
            var sQuery = oEvent.getParameter("arguments").query || "all";
            this.byId("statusFilter").setSelectedKey(sQuery);
            this._applyFilter(sQuery);
        },
        _applyFilter: function (sStatus) {
            var aFilters = [];
            if (sStatus && sStatus !== "all") aFilters.push(new Filter("status", FilterOperator.EQ, sStatus));
            this.byId("overtimeTable").getBinding("items").filter(aFilters);
        },
        onStatusChange: function () { this._applyFilter(this.byId("statusFilter").getSelectedKey()); },
        onRefresh: function () { this.getView().getModel().refresh(); MessageToast.show("Refreshed"); },
        onCreate: function () { this._oRouter.navTo("overtimeCreate"); },
        onItemPress: function (oEvent) {
            var sId = oEvent.getParameter("listItem").getBindingContext().getProperty("ID");
            this._oRouter.navTo("overtimeDetail", { ID: sId });
        },
        onNavBack: function () { this._oRouter.navTo("employeeDashboard", {}, true); }
    });
});
