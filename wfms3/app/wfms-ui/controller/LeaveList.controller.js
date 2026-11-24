sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters"
], function (Controller, Filter, FilterOperator, MessageToast, formatters) {
    "use strict";

    return Controller.extend("wfms.ui.controller.LeaveList", {
        formatters: formatters,

        onInit: function () {
            this._oRouter = this.getOwnerComponent().getRouter();
            this._oRouter.getRoute("leaveList").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sQuery = oEvent.getParameter("arguments").query || "all";
            // Apply the status filter passed from the dashboard tile click
            var oSelect = this.byId("statusFilter");
            if (sQuery && sQuery !== "all") {
                oSelect.setSelectedKey(sQuery);
                this._applyFilter(sQuery);
            } else {
                oSelect.setSelectedKey("all");
                this._applyFilter("all");
            }
        },

        _applyFilter: function (sStatus) {
            var aFilters = [];
            // Instance authorization on the backend scopes to the current employee's
            // own records for Employee role; managers/HR see broader scope.
            if (sStatus && sStatus !== "all") {
                aFilters.push(new Filter("status", FilterOperator.EQ, sStatus));
            }
            var sSearch = this.byId("searchField").getValue();
            if (sSearch) {
                aFilters.push(new Filter("reason", FilterOperator.Contains, sSearch));
            }
            var oTable = this.byId("leaveTable");
            var oBinding = oTable && oTable.getBinding("items");
            if (oBinding) { oBinding.filter(aFilters); }
        },

        onSearch: function () {
            this._applyFilter(this.byId("statusFilter").getSelectedKey());
        },
        onStatusChange: function () {
            this._applyFilter(this.byId("statusFilter").getSelectedKey());
        },
        onRefresh: function () {
            this.getView().getModel().refresh();
            MessageToast.show("Refreshed");
        },
        onCreate: function () {
            this._oRouter.navTo("leaveCreate");
        },
        onItemPress: function (oEvent) {
            var sId = oEvent.getParameter("listItem").getBindingContext().getProperty("ID");
            this._oRouter.navTo("leaveDetail", { ID: sId });
        },
        onNavBack: function () {
            this._oRouter.navTo("employeeDashboard", {}, true);
        }
    });
});
