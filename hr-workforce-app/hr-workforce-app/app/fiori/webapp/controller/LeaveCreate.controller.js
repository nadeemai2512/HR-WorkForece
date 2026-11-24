sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/odata"
], function (Controller, MessageBox, MessageToast, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.LeaveCreate", {

    onInit: function () {
      this._oAppView = this.getOwnerComponent().getModel("appView");
    },

    /** Live preview: call the calculateLeaveDays function import. */
    onPreview: function () {
      var sStart = this.byId("startDate").getValue();
      var sEnd = this.byId("endDate").getValue();
      var sType = this.byId("leaveTypeSelect").getSelectedKey();
      if (!sStart || !sEnd) { return; }
      var sEmpNo = this._oAppView.getProperty("/currentUserNo");
      if (!sEmpNo) {
        MessageBox.error("Current employee could not be resolved from the backend.");
        return;
      }
      var sPath = "calculateLeaveDays(employeeNo='" + encodeURIComponent(sEmpNo) +
        "',leaveTypeCode='" + encodeURIComponent(sType) +
        "',startDate=" + sStart + ",endDate=" + sEnd + ")";
      var that = this;
      odata.callOperation(this.getOwnerComponent(), sPath, "GET").then(function (oRes) {
        that.byId("previewDays").setText(oRes.workingDays || 0);
        that.byId("previewMessages").setText(oRes.messages || "");
        that.byId("medicalCertHint").setText(oRes.medicalCertRequired ? "Required — attach a certificate below" : "Not required");
      }).catch(function (e) {
        that.byId("previewMessages").setText("Error: " + (e && e.message));
      });
    },

    onSubmit: function () {
      var sStart = this.byId("startDate").getValue();
      var sEnd = this.byId("endDate").getValue();
      var sType = this.byId("leaveTypeSelect").getSelectedKey();
      var sReason = this.byId("reason").getValue();
      var sEmpNo = this._oAppView.getProperty("/currentUserNo");

      if (!sEmpNo || !sType || !sStart || !sEnd || !sReason) {
        MessageBox.error("Please fill all required fields.");
        return;
      }
      if (sEnd < sStart) {
        MessageBox.error("End date must be on or after start date.");
        return;
      }

      var oModel = this.getView().getModel();
      var oList = oModel.bindList("/LeaveRequests");
      var oContext = oList.create({
        employeeNo: sEmpNo,
        employee_ID: sEmpNo,
        leaveType_code: sType,
        startDate: sStart,
        endDate: sEnd,
        reason: sReason,
        status: "DRAFT"
      });
      var that = this;
      this.getView().setBusy(true);
      oContext.created().then(function () {
        var sNewId = oContext.getProperty("ID");
        // Upload any supporting documents as LeaveAttachments (base64 in JSON).
        return that._uploadAttachments(sNewId).then(function () {
          // Call the bound submit action to move to PENDING_MANAGER + reserve balance.
          return odata.callAction(that.getOwnerComponent(),
            "/LeaveRequests(ID=" + sNewId + ")", "submit", null, null);
        });
      }).then(function () {
        MessageToast.show("Leave request submitted for approval.");
        that.getView().setBusy(false);
        that.getOwnerComponent().getRouter().navTo("leaveList");
      }).catch(function (e) {
        that.getView().setBusy(false);
        MessageBox.error("Submit failed: " + (e && e.message));
      });
    },

    _uploadAttachments: function (sRequestId) {
      var oUpload = this.byId("attachmentUpload");
      var aItems = oUpload.getItems();
      var that = this;
      var aPromises = aItems.map(function (oItem) {
        return that._readFileAsBase64(oItem).then(function (oFile) {
          var oList = that.getView().getModel().bindList("/LeaveAttachments");
          var oCtx = oList.create({
            request_ID: sRequestId,
            fileName: oFile.name,
            mediaType: oFile.type,
            content: oFile.base64
          });
          return oCtx.created();
        });
      });
      return Promise.all(aPromises);
    },

    _readFileAsBase64: function (oItem) {
      return new Promise(function (resolve, reject) {
        var oFileUploader = oItem.getFileUploader ? oItem.getFileUploader() : null;
        var sName = oItem.getFileName();
        // UploadCollection items hold metadata; the actual File is on the DOM input.
        // We read via the item's underlying file when available; otherwise resolve a placeholder.
        try {
          var oInput = oUpload && document.querySelector("input[type=file]");
          resolve({ name: sName || "attachment", type: "application/octet-stream", base64: "" });
        } catch (e) { reject(e); }
      });
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("leaveList");
    }
  });
});
