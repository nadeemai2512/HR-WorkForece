sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter",
  "hr/fiori/model/odata"
], function (Controller, Filter, FilterOperator, MessageToast, formatter, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.OvertimeList", {
    formatter: formatter,

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
      var sPending = this._oAppView.getProperty("/pendingFilter");
      if (sPending) {
        this.byId("statusFilter").setSelectedKey(sPending === "pending" ? "PENDING_MANAGER" : sPending === "approved" ? "APPROVED" : "ALL");
        this._oAppView.setProperty("/pendingFilter", null);
        this.applyFilters();
      }
    },

    onFilterChange: function () { this.applyFilters(); },

    applyFilters: function () {
      var sStatus = this.byId("statusFilter").getSelectedKey();
      var aFilters = [];
      if (sStatus && sStatus !== "ALL") {
        aFilters.push(new Filter("status", FilterOperator.EQ, sStatus));
      }
      this.byId("otTable").getBinding("items").filter(aFilters);
    },

    onCreate: function () { this.getOwnerComponent().getRouter().navTo("overtimeCreate"); },

    onExport: function () {
      var oBinding = this.byId("otTable").getBinding("items");
      oBinding.requestContexts(0, 1000).then(function (aCtx) {
        var aRows = aCtx.map(function (c) { return c.getObject(); });
        odata.exportToCsv("overtime-summary.csv",
          ["workDate", "otStart", "otEnd", "otHours", "otType", "multiplier", "estimatedAmount", "compOffCredits", "status"],
          aRows);
      });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("employeeDashboard"); }
  });
});
