sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/odata"
], function (Controller, MessageBox, MessageToast, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.OvertimeCreate", {

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
    },

    onSubmit: function () {
      var sEmpNo = this._oAppView.getProperty("/currentUserNo");
      var sWorkDate = this.byId("workDate").getValue();
      var sStart = this.byId("otStart").getValue();
      var sEnd = this.byId("otEnd").getValue();
      var sRegular = this.byId("regularShiftHours").getValue();
      var bCompOff = this.byId("convertToCompOff").getSelected();
      var sReason = this.byId("reason").getValue();

      if (!sEmpNo || !sWorkDate || !sStart || !sEnd || !sReason) {
        MessageBox.error("Please fill all required fields.");
        return;
      }

      var oModel = this.getView().getModel();
      var oList = oModel.bindList("/OvertimeRequests");
      var oContext = oList.create({
        employeeNo: sEmpNo,
        employee_ID: sEmpNo,
        workDate: sWorkDate,
        otStart: sStart,
        otEnd: sEnd,
        regularShiftHours: parseFloat(sRegular) || 0,
        convertToCompOff: bCompOff,
        reason: sReason,
        status: "DRAFT"
      });
      var that = this;
      this.getView().setBusy(true);
      oContext.created().then(function () {
        var sNewId = oContext.getProperty("ID");
        // Show compliance messages computed by the backend CREATE hook.
        var sMsg = oContext.getProperty("complianceMessages");
        if (sMsg) {
          var oStrip = that.byId("complianceStrip");
          oStrip.setText(sMsg);
          oStrip.setVisible(true);
        }
        // Submit -> PENDING_MANAGER.
        return odata.callAction(that.getOwnerComponent(),
          "/OvertimeRequests(" + sNewId + ")", "submit", null, null);
      }).then(function () {
        MessageToast.show("Overtime request submitted for approval.");
        that.getView().setBusy(false);
        that.getOwnerComponent().getRouter().navTo("overtimeList");
      }).catch(function (e) {
        that.getView().setBusy(false);
        MessageBox.error("Submit failed: " + (e && e.message));
      });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("overtimeList");
    }
  });
});
