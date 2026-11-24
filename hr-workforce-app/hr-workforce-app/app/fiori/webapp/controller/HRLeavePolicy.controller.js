sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/Input",
  "sap/m/CheckBox",
  "sap/m/Label",
  "sap/m/VBox",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/formatter"
], function (Controller, JSONModel, Dialog, Button, Input, CheckBox, Label, VBox, MessageBox, MessageToast, formatter) {
  "use strict";

  return Controller.extend("hr.fiori.controller.HRLeavePolicy", {
    formatter: formatter,

    onInit: function () {
      this._oFormModel = new JSONModel({});
    },

    /** Generic create dialog built from a field descriptor. */
    _openCreate: function (sEntity, sTitle, aFields, oDefaults) {
      var oData = Object.assign({}, oDefaults);
      this._oFormModel.setData(oData);
      var that = this;
      var aControls = aFields.map(function (f) {
        var oCtrl;
        if (f.type === "bool") {
          oCtrl = new CheckBox({ selected: "{oForm>/" + f.key + "}" });
        } else {
          oCtrl = new Input({ value: "{oForm>/" + f.key + "}", type: f.type === "number" ? "Number" : "Text" });
        }
        return new VBox({ items: [new Label({ text: f.label, required: !!f.required }), oCtrl] });
      });
      var oDialog = new Dialog({
        title: sTitle,
        content: aControls,
        beginButton: new Button({ text: "Save", type: "Emphasized", press: function () {
          var oPayload = that._oFormModel.getData();
          var oList = that.getView().getModel().bindList("/" + sEntity);
          that.getView().setBusy(true);
          var oCtx = oList.create(oPayload);
          oCtx.created().then(function () {
            MessageToast.show(sEntity + " created.");
            oDialog.close();
          }).catch(function (e) {
            MessageBox.error("Create failed: " + (e && e.message));
          }).finally(function () { that.getView().setBusy(false); });
        }}),
        endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
        afterClose: function () { oDialog.destroy(); }
      });
      oDialog.setModel(this._oFormModel, "oForm");
      this.getView().addDependent(oDialog);
      oDialog.open();
    },

    onAddLeaveType: function () {
      this._openCreate("LeaveTypes", "Add Leave Type", [
        { key: "code", label: "Code", required: true },
        { key: "name", label: "Name", required: true },
        { key: "allowNegativeBalance", label: "Allow Negative", type: "bool" },
        { key: "exemptFromBlackout", label: "Exempt Blackout", type: "bool" },
        { key: "exemptFromAdvanceNotice", label: "Exempt Advance Notice", type: "bool" },
        { key: "medicalCertThresholdDays", label: "Med Cert Threshold (days)", type: "number" },
        { key: "active", label: "Active", type: "bool" }
      ], { allowNegativeBalance: false, exemptFromBlackout: false, exemptFromAdvanceNotice: false, medicalCertThresholdDays: 2, active: true });
    },

    onAddPolicy: function () {
      this._openCreate("LeavePolicies", "Add Leave Policy", [
        { key: "leaveType_code", label: "Leave Type Code", required: true },
        { key: "annualEntitlement", label: "Annual Entitlement", type: "number", required: true },
        { key: "longLeaveThresholdDays", label: "Long Leave Threshold", type: "number" },
        { key: "minAdvanceDaysForLongLeave", label: "Min Advance Days", type: "number" },
        { key: "effectiveFrom", label: "Effective From (yyyy-mm-dd)", required: true }
      ], { longLeaveThresholdDays: 3, minAdvanceDaysForLongLeave: 7, effectiveFrom: new Date().toISOString().substring(0, 10) });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
