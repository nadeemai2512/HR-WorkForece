sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter",
  "hr/fiori/model/odata"
], function (Controller, MessageBox, MessageToast, formatter, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.EmployeeDashboard", {
    formatter: formatter,

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
      this._resolveCurrentUser();
    },

    /** Resolve the logged-in employee number from the backend (READ is scope-filtered). */
    _resolveCurrentUser: function () {
      var that = this;
      var oModel = this.getView().getModel();
      var oListBinding = oModel.bindList("/Employees");
      oListBinding.requestContexts(0, 1).then(function (aContexts) {
        if (aContexts && aContexts.length) {
          var sEmpNo = aContexts[0].getProperty("employeeNo");
          var sRole = aContexts[0].getProperty("roleCategory");
          that._oAppView.setProperty("/currentUserNo", sEmpNo);
          that._oAppView.setProperty("/currentRole", sRole);
          that._loadDashboard(sEmpNo);
        }
      }).catch(function () {
        MessageToast.show("Could not load current user from backend.");
      });
    },

    /** Fetch all KPI values from the getEmployeeDashboard function import. */
    _loadDashboard: function (sEmpNo) {
      var that = this;
      this._oAppView.setProperty("/busy", true);
      odata.callOperation(this.getOwnerComponent(),
        "getEmployeeDashboard(employeeNo='" + encodeURIComponent(sEmpNo) + "')", "GET")
        .then(function (oData) {
          that._oAppView.setProperty("/employeeDashboard", oData || {});
        })
        .catch(function (e) {
          MessageBox.error("Failed to load dashboard: " + (e && e.message));
        })
        .finally(function () {
          that._oAppView.setProperty("/busy", false);
        });
    },

    onTilePress: function (oEvent) {
      var oSrc = oEvent.getSource();
      var sRoute = oSrc.data("route");
      var sFilter = oSrc.data("filter");
      if (sFilter) {
        this._oAppView.setProperty("/pendingFilter", sFilter);
      }
      this.getRouter().navTo(sRoute);
    },

    onApplyLeave: function () { this.getRouter().navTo("leaveCreate"); },
    onSubmitOvertime: function () { this.getRouter().navTo("overtimeCreate"); },
    onGoShifts: function () { this.getRouter().navTo("myShifts"); },
    onGoLeaveList: function () { this.getRouter().navTo("leaveList"); },
    onComplianceAlerts: function () { this.getRouter().navTo("reports"); },

    onLeaveItemPress: function (oEvent) {
      var sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getRouter().navTo("leaveDetail", { objectId: sId });
    },

    onSwapShift: function (oEvent) {
      var sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getRouter().navTo("shiftSwapCreate", { assignmentId: sId });
    },

    getRouter: function () { return this.getOwnerComponent().getRouter(); },

    onExit: function () {}
  });
});
