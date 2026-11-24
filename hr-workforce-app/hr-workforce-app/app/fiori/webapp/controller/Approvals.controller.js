sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter",
  "hr/fiori/model/odata"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast, formatter, odata) {
  "use strict";

  var PENDING_FILTER = new Filter("status", FilterOperator.EQ, "PENDING_MANAGER");

  return Controller.extend("hr.fiori.controller.Approvals", {
    formatter: formatter,

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
      this.getView().setModel(new JSONModel({ title: "", comment: "", confirmText: "OK", confirmType: "Emphasized" }), "dialog");
    },

    onAfterRendering: function () {
      var sTab = this._oAppView.getProperty("/approvalsTab") || "leave";
      this.byId("approvalsTabs").setSelectedKey(sTab);
      this._applyFilters();
    },

    onTabSelect: function (oEvent) {
      this._oAppView.setProperty("/approvalsTab", oEvent.getParameter("key"));
    },

    _applyFilters: function () {
      ["leaveApprovals", "otApprovals", "swapApprovals"].forEach(function (sId) {
        var oBinding = this.byId(sId).getBinding("items");
        if (oBinding) { oBinding.filter([PENDING_FILTER]); }
      }.bind(this));
    },

    /* ---- generic approval action with comment dialog ---- */
    _openApprovalDialog: function (sTitle, sConfirmText, sConfirmType, fnConfirm) {
      var oDialogModel = this.getView().getModel("dialog");
      oDialogModel.setData({ title: sTitle, comment: "", confirmText: sConfirmText, confirmType: sConfirmType });
      this._fnConfirm = fnConfirm;
      if (!this._oDialog) {
        this._oDialog = sap.ui.xmlfragment(this.getView().getId(), "hr.fiori.fragment.ApprovalDialog", this);
        this.getView().addDependent(this._oDialog);
      }
      this._oDialog.open();
    },

    onConfirmApproval: function () {
      var sComment = this.byId("approvalComment").getValue();
      this._oDialog.close();
      if (this._fnConfirm) { this._fnConfirm(sComment); }
    },

    onCancelApproval: function () {
      this._oDialog.close();
      this._fnConfirm = null;
    },

    _execAction: function (sEntityType, sId, sAction, sComment) {
      var sPath = "/" + sEntityType + "(ID='" + sId + "')";
      // ShiftSwapRequests key is also ID (cuid). LeaveRequests & OvertimeRequests key is ID.
      var that = this;
      this.getView().setBusy(true);
      odata.callAction(this.getOwnerComponent(), sPath, sAction, sAction === "cancel" ? null : "comment", sComment)
        .then(function () {
          MessageToast.show(sAction + " completed.");
          that._refreshAll();
        })
        .catch(function (e) { MessageBox.error("Action failed: " + (e && e.message)); })
        .finally(function () { that.getView().setBusy(false); });
    },

    _refreshAll: function () {
      ["leaveApprovals", "otApprovals", "swapApprovals"].forEach(function (sId) {
        var b = this.byId(sId).getBinding("items");
        if (b) { b.refresh(); }
      }.bind(this));
    },

    /* ---- Leave ---- */
    onApproveLeave: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var sId = oCtx.getProperty("ID");
      var that = this;
      this._openApprovalDialog("Approve Leave Request", "Approve", "Accept", function (c) {
        that._execAction("LeaveRequests", sId, "approve", c);
      });
    },
    onRejectLeave: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(); var sId = oCtx.getProperty("ID"); var that = this;
      this._openApprovalDialog("Reject Leave Request", "Reject", "Reject", function (c) {
        that._execAction("LeaveRequests", sId, "rejectRequest", c);
      });
    },
    onSendBackLeave: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(); var sId = oCtx.getProperty("ID"); var that = this;
      this._openApprovalDialog("Send Back Leave Request", "Send Back", "Emphasized", function (c) {
        that._execAction("LeaveRequests", sId, "sendBack", c);
      });
    },
    onViewLeaveDetails: function (oEvent) {
      var sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("leaveDetail", { objectId: sId });
    },

    /* ---- Overtime ---- */
    onApproveOvertime: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(); var sId = oCtx.getProperty("ID"); var that = this;
      this._openApprovalDialog("Approve Overtime Request", "Approve", "Accept", function (c) {
        that._execAction("OvertimeRequests", sId, "approve", c);
      });
    },
    onRejectOvertime: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(); var sId = oCtx.getProperty("ID"); var that = this;
      this._openApprovalDialog("Reject Overtime Request", "Reject", "Reject", function (c) {
        that._execAction("OvertimeRequests", sId, "rejectRequest", c);
      });
    },
    onSendBackOvertime: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(); var sId = oCtx.getProperty("ID"); var that = this;
      this._openApprovalDialog("Send Back Overtime Request", "Send Back", "Emphasized", function (c) {
        that._execAction("OvertimeRequests", sId, "sendBack", c);
      });
    },

    /* ---- Swap ---- */
    onApproveSwap: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(); var sId = oCtx.getProperty("ID"); var that = this;
      this._openApprovalDialog("Approve Shift Swap", "Approve", "Accept", function (c) {
        that._execAction("ShiftSwapRequests", sId, "approve", c);
      });
    },
    onRejectSwap: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext(); var sId = oCtx.getProperty("ID"); var that = this;
      this._openApprovalDialog("Reject Shift Swap", "Reject", "Reject", function (c) {
        that._execAction("ShiftSwapRequests", sId, "rejectRequest", c);
      });
    },

    onViewEmployee: function (oEvent) {
      var sEmpNo = oEvent.getSource().getBindingContext().getProperty("employeeNo") ||
        oEvent.getSource().getBindingContext().getProperty("requestor_ID");
      this._oAppView.setProperty("/focusEmployeeNo", sEmpNo);
      MessageBox.information("Employee " + sEmpNo + " — full employee details screen is available under HR > Employee Management.");
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
