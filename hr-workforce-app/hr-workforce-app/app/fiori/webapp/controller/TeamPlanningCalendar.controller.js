sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter"
], function (Controller, Filter, FilterOperator, MessageToast, formatter) {
  "use strict";

  return Controller.extend("hr.fiori.controller.TeamPlanningCalendar", {
    formatter: formatter,

    onInit: function () { this._aFilters = []; },

    onFilterChange: function () {
      var aFilters = [];
      var sDept = this.byId("deptFilter").getSelectedKey();
      var sSearch = this.byId("empSearch").getValue();
      if (sDept && sDept !== "ALL") {
        aFilters.push(new Filter("department_code", FilterOperator.EQ, sDept));
      }
      if (sSearch) {
        aFilters.push(new Filter("fullName", FilterOperator.Contains, sSearch));
      }
      this.byId("planningCal").getBinding("rows").filter(aFilters);
    },

    onViewChange: function (oEvent) {
      this.byId("planningCal").setViewKey(oEvent.getParameter("selectedItem").getKey());
    },

    onAppointmentSelect: function (oEvent) {
      var oAppt = oEvent.getParameter("appointment");
      if (oAppt) {
        var oCtx = oAppt.getBindingContext();
        MessageToast.show("Shift " + oCtx.getProperty("template_code") + " for " +
          oCtx.getProperty("employeeNo") + " on " + oCtx.getProperty("shiftDate"));
      }
    },

    onRowSelect: function (oEvent) {
      var oRow = oEvent.getParameter("row");
      if (oRow) {
        MessageToast.show("Selected: " + oRow.getTitle());
      }
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
