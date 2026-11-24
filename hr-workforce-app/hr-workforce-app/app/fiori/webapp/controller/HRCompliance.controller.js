sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/Dialog", "sap/m/Button", "sap/m/Input", "sap/m/Label", "sap/m/VBox",
  "sap/m/MessageBox", "sap/m/MessageToast",
  "hr/fiori/model/formatter"
], function (Controller, JSONModel, Dialog, Button, Input, Label, VBox, MessageBox, MessageToast, formatter) {
  "use strict";

  return Controller.extend("hr.fiori.controller.HRCompliance", {
    formatter: formatter,
    onInit: function () { this._oFormModel = new JSONModel({}); },

    _openCreate: function (sEntity, sTitle, aFields, oDefaults) {
      var oData = Object.assign({}, oDefaults);
      this._oFormModel.setData(oData);
      var that = this;
      var aControls = aFields.map(function (f) {
        var oCtrl = new Input({ value: "{oForm>/" + f.key + "}", type: f.type === "number" ? "Number" : "Text" });
        return new VBox({ items: [new Label({ text: f.label, required: !!f.required }), oCtrl] });
      });
      var oDialog = new Dialog({
        title: sTitle, content: aControls,
        beginButton: new Button({ text: "Save", type: "Emphasized", press: function () {
          var oPayload = that._oFormModel.getData();
          var oList = that.getView().getModel().bindList("/" + sEntity);
          that.getView().setBusy(true);
          var oCtx = oList.create(oPayload);
          oCtx.created().then(function () { MessageToast.show(sEntity + " created."); oDialog.close(); })
            .catch(function (e) { MessageBox.error("Create failed: " + (e && e.message)); })
            .finally(function () { that.getView().setBusy(false); });
        }}),
        endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
        afterClose: function () { oDialog.destroy(); }
      });
      oDialog.setModel(this._oFormModel, "oForm");
      this.getView().addDependent(oDialog);
      oDialog.open();
    },

    onAddRule: function () {
      this._openCreate("ComplianceRules", "Add Compliance Rule", [
        { key: "jurisdiction", label: "Jurisdiction", required: true },
        { key: "dailyMaxHours", label: "Daily Max Hours", type: "number" },
        { key: "weeklyRegularHours", label: "Weekly Regular Hours", type: "number" },
        { key: "weeklyOTAllowance", label: "Weekly OT Allowance", type: "number" },
        { key: "weeklyMaxHours", label: "Weekly Max Hours", type: "number" },
        { key: "quarterlyOTLimit", label: "Quarterly OT Limit", type: "number" },
        { key: "quarterlyWarnAt", label: "Warn At", type: "number" },
        { key: "minRestHours", label: "Min Rest Hours", type: "number" },
        { key: "effectiveFrom", label: "Effective From (yyyy-mm-dd)", required: true }
      ], {
        jurisdiction: "IN-DEFAULT", dailyMaxHours: 12, weeklyRegularHours: 48,
        weeklyOTAllowance: 12, weeklyMaxHours: 60, quarterlyOTLimit: 50,
        quarterlyWarnAt: 40, minRestHours: 11, effectiveFrom: new Date().toISOString().substring(0, 10)
      });
    },

    onAddOtPolicy: function () {
      this._openCreate("OvertimePolicies", "Add Overtime Policy", [
        { key: "otType", label: "OT Type (WEEKDAY/WEEKEND/HOLIDAY)", required: true },
        { key: "multiplier", label: "Multiplier", type: "number", required: true },
        { key: "compOffConversionRate", label: "Comp-Off Conversion Rate", type: "number" },
        { key: "jurisdiction", label: "Jurisdiction" },
        { key: "effectiveFrom", label: "Effective From (yyyy-mm-dd)", required: true }
      ], { compOffConversionRate: 1.0, jurisdiction: "ALL", effectiveFrom: new Date().toISOString().substring(0, 10) });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
