sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/odata"
], function (Controller, JSONModel, MessageBox, MessageToast, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.ShiftSwapCreate", {

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
      this.getView().setModel(new JSONModel([]), "swapCandidates");
      var oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute("shiftSwapCreate").attachPatternMatched(this._onMatched, this);
    },

    _onMatched: function (oEvent) {
      this._sAssignmentId = oEvent.getParameter("arguments").assignmentId;
      this.getView().bindElement("/ShiftAssignments(" + this._sAssignmentId + ")");
      this._loadCandidates();
    },

    _loadCandidates: function () {
      var sEmpNo = this._oAppView.getProperty("/currentUserNo");
      var that = this;
      odata.callOperation(this.getOwnerComponent(),
        "getSwapCandidates(employeeNo='" + encodeURIComponent(sEmpNo) +
        "',assignment_ID='" + encodeURIComponent(this._sAssignmentId) + "')", "GET")
        .then(function (aCandidates) {
          that.getView().getModel("swapCandidates").setData(aCandidates || []);
          if (!aCandidates || !aCandidates.length) {
            MessageBox.information("No eligible swap candidates found for this shift.");
          }
        })
        .catch(function (e) {
          MessageBox.error("Could not load candidates: " + (e && e.message));
        });
    },

    onSubmit: function () {
      var sTarget = this.byId("targetSelect").getSelectedKey();
      var sReason = this.byId("reason").getValue();
      var sRequestor = this._oAppView.getProperty("/currentUserNo");
      if (!sTarget || !sReason) {
        MessageBox.error("Select a colleague and provide a reason.");
        return;
      }

      var oList = this.getView().getModel().bindList("/ShiftSwapRequests");
      var oContext = oList.create({
        requestor_ID: sRequestor,
        targetEmployee_ID: sTarget,
        assignment_ID: this._sAssignmentId,
        reason: sReason,
        status: "SUBMITTED"
      });
      var that = this;
      this.getView().setBusy(true);
      oContext.created().then(function () {
        var sNewId = oContext.getProperty("ID");
        return odata.callAction(that.getOwnerComponent(),
          "/ShiftSwapRequests(" + sNewId + ")", "submit", null, null);
      }).then(function () {
        MessageToast.show("Swap request submitted to peer for acceptance.");
        that.getView().setBusy(false);
        that.getOwnerComponent().getRouter().navTo("myShifts");
      }).catch(function (e) {
        that.getView().setBusy(false);
        MessageBox.error("Submit failed: " + (e && e.message));
      });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("myShifts"); }
  });
});
