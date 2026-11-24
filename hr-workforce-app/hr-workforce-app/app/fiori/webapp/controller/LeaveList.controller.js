sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter"
], function (Controller, Filter, FilterOperator, MessageToast, formatter) {
  "use strict";

  return Controller.extend("hr.fiori.controller.LeaveList", {
    formatter: formatter,

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
      var sPending = this._oAppView.getProperty("/pendingFilter");
      if (sPending) {
        this.byId("statusFilter").setSelectedKey(
          sPending === "pending" ? "PENDING_MANAGER" : sPending === "approved" ? "APPROVED" : "ALL");
        this._oAppView.setProperty("/pendingFilter", null);
        this.applyFilters();
      }
    },

    onFilterChange: function () { this.applyFilters(); },

    onSearch: function (oEvent) {
      this._sSearch = oEvent.getParameter("newValue");
      this.applyFilters();
    },

    applyFilters: function () {
      var aFilters = [];
      var sStatus = this.byId("statusFilter").getSelectedKey();
      var sType = this.byId("typeFilter").getSelectedKey();
      if (sStatus && sStatus !== "ALL") {
        aFilters.push(new Filter("status", FilterOperator.EQ, sStatus));
      }
      if (sType && sType !== "ALL") {
        aFilters.push(new Filter("leaveType_code", FilterOperator.EQ, sType));
      }
      if (this._sSearch) {
        aFilters.push(new Filter("reason", FilterOperator.Contains, this._sSearch));
      }
      var oBinding = this.byId("leaveTable").getBinding("items");
      oBinding.filter(aFilters);
    },

    onUpdateFinished: function (oEvent) {
      var iTotal = oEvent.getParameter("total");
      this.getView().byId("leaveListPage").setBusy(false);
      if (iTotal !== undefined) {
        MessageToast.show(iTotal + " record(s)");
      }
    },

    onItemPress: function (oEvent) {
      var sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("leaveDetail", { objectId: sId });
    },

    onSelectionChange: function (oEvent) {
      if (oEvent.getParameter("listItem")) {
        var sId = oEvent.getParameter("listItem").getBindingContext().getProperty("ID");
        this.getOwnerComponent().getRouter().navTo("leaveDetail", { objectId: sId });
      }
    },

    onApplyLeave: function () {
      this.getOwnerComponent().getRouter().navTo("leaveCreate");
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("employeeDashboard");
    }
  });
});
