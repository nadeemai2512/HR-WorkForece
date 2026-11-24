sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter",
  "hr/fiori/model/odata"
], function (Controller, MessageBox, MessageToast, formatter, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.ManagerDashboard", {
    formatter: formatter,

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
      this._resolveAndLoad();
    },

    _resolveAndLoad: function () {
      var that = this;
      var oListBinding = this.getView().getModel().bindList("/Employees");
      oListBinding.requestContexts(0, 1).then(function (aContexts) {
        if (aContexts && aContexts.length) {
          var sEmpNo = aContexts[0].getProperty("employeeNo");
          that._oAppView.setProperty("/currentUserNo", sEmpNo);
          that._loadDashboard(sEmpNo);
        }
      });
    },

    _loadDashboard: function (sManagerNo) {
      var that = this;
      this._oAppView.setProperty("/busy", true);
      odata.callOperation(this.getOwnerComponent(),
        "getManagerDashboard(managerNo='" + encodeURIComponent(sManagerNo) + "')", "GET")
        .then(function (oData) {
          that._oAppView.setProperty("/managerDashboard", oData || {});
        })
        .catch(function (e) {
          MessageBox.error("Failed to load manager dashboard: " + (e && e.message));
        })
        .finally(function () { that._oAppView.setProperty("/busy", false); });
    },

    onGoPlanning: function () { this.getOwnerComponent().getRouter().navTo("teamPlanning"); },
    onGoApprovals: function () { this._oAppView.setProperty("/approvalsTab", "leave"); this.getOwnerComponent().getRouter().navTo("approvals"); },
    onGoApprovalsLeave: function () { this._oAppView.setProperty("/approvalsTab", "leave"); this.getOwnerComponent().getRouter().navTo("approvals"); },
    onGoApprovalsOvertime: function () { this._oAppView.setProperty("/approvalsTab", "overtime"); this.getOwnerComponent().getRouter().navTo("approvals"); },
    onGoApprovalsSwap: function () { this._oAppView.setProperty("/approvalsTab", "swap"); this.getOwnerComponent().getRouter().navTo("approvals"); },
    onGoReports: function () { this.getOwnerComponent().getRouter().navTo("reports"); },

    onTeamMemberPress: function (oEvent) {
      var sNo = oEvent.getSource().getBindingContext().getProperty("employeeNo");
      this._oAppView.setProperty("/focusEmployeeNo", sNo);
      this.getOwnerComponent().getRouter().navTo("teamPlanning");
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("employeeDashboard"); }
  });
});
