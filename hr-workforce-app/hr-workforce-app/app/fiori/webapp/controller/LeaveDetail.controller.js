sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter",
  "hr/fiori/model/odata"
], function (Controller, MessageBox, MessageToast, formatter, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.LeaveDetail", {
    formatter: formatter,

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
      var oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute("leaveDetail").attachPatternMatched(this._onMatched, this);
    },

    _onMatched: function (oEvent) {
      var sId = oEvent.getParameter("arguments").objectId;
      this._sId = sId;
      this.getView().bindElement("/LeaveRequests(ID='" + sId + "')", {}, function (oContext) {
        if (!oContext) { MessageBox.error("Leave request not found."); return; }
      });
      // Show cancel only for cancellable statuses owned by current user.
      var sMe = this._oAppView.getProperty("/currentUserNo");
      this.byId("cancelBtn").setVisible(true);
    },

    onCancelRequest: function () {
      var that = this;
      MessageBox.confirm("Cancel this leave request?", {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.OK) { return; }
          that.getView().setBusy(true);
          odata.callAction(that.getOwnerComponent(),
            "/LeaveRequests(ID='" + that._sId + "')", "cancel", null, null)
            .then(function () {
              MessageToast.show("Leave request cancelled.");
              that.getView().getElementBinding().refresh();
            })
            .catch(function (e) { MessageBox.error("Cancel failed: " + (e && e.message)); })
            .finally(function () { that.getView().setBusy(false); });
        }
      });
    },

    onDownloadAttachment: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var sId = oCtx.getProperty("ID");
      var sMedia = oCtx.getProperty("mediaType") || "application/octet-stream";
      var sUrl = this.getOwnerComponent().getManifestObject()["sap.app"].dataSources.mainService.uri +
        "LeaveAttachments(" + sId + ")/content";
      window.open(sUrl, "_blank");
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("leaveList");
    }
  });
});
