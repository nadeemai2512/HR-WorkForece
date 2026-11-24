sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter"
], function (Controller, MessageToast, formatter) {
  "use strict";

  return Controller.extend("hr.fiori.controller.MyShifts", {
    formatter: formatter,

    onInit: function () {
      this._sSelectedAssignmentId = null;
    },

    onShiftSelect: function (oEvent) {
      var oItem = oEvent.getParameter("listItem");
      if (oItem) {
        this._sSelectedAssignmentId = oItem.getBindingContext().getProperty("ID");
        this.byId("swapBtn").setEnabled(true);
      }
    },

    onSwapSelected: function () {
      if (this._sSelectedAssignmentId) {
        this.getOwnerComponent().getRouter().navTo("shiftSwapCreate", { assignmentId: this._sSelectedAssignmentId });
      }
    },

    onAppointmentSelect: function (oEvent) {
      var oAppt = oEvent.getParameter("appointment");
      if (oAppt) {
        var oCtx = oAppt.getBindingContext();
        if (oCtx) {
          this._sSelectedAssignmentId = oCtx.getProperty("ID");
          this.byId("swapBtn").setEnabled(true);
        }
      }
    },

    onRangeChange: function (oEvent) {
      var sKey = oEvent.getParameter("selectedItem").getKey();
      this.byId("planningCal").setViewKey(sKey);
    },

    onRefresh: function () {
      this.byId("shiftTable").getBinding("items").refresh();
      MessageToast.show("Shifts refreshed.");
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("employeeDashboard"); }
  });
});
