sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "hr/fiori/model/odata"
], function (Controller, Filter, FilterOperator, MessageToast, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.AuditLogs", {

    onFilterChange: function () { this.applyFilters(); },
    onSearch: function (oEvent) { this._sSearch = oEvent.getParameter("newValue"); this.applyFilters(); },

    applyFilters: function () {
      var aFilters = [];
      var sAction = this.byId("actionFilter").getSelectedKey();
      if (sAction && sAction !== "ALL") {
        aFilters.push(new Filter("action", FilterOperator.EQ, sAction));
      }
      if (this._sSearch) {
        aFilters.push(new Filter("reason", FilterOperator.Contains, this._sSearch));
      }
      this.byId("auditTable").getBinding("items").filter(aFilters);
    },

    onExport: function () {
      var oBinding = this.byId("auditTable").getBinding("items");
      oBinding.requestContexts(0, 10000).then(function (aCtx) {
        var aRows = aCtx.map(function (c) { return c.getObject(); });
        odata.exportToCsv("audit-logs.csv",
          ["timestamp", "userId", "action", "entityType", "entityId", "prevValue", "newValue", "reason"], aRows);
        MessageToast.show("Audit logs exported.");
      });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
