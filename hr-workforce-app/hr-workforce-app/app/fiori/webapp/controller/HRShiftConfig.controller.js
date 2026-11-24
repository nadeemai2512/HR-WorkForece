sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/Dialog", "sap/m/Button", "sap/m/Input", "sap/m/CheckBox", "sap/m/Label", "sap/m/VBox",
  "sap/m/MessageBox", "sap/m/MessageToast",
  "hr/fiori/model/formatter"
], function (Controller, JSONModel, Dialog, Button, Input, CheckBox, Label, VBox, MessageBox, MessageToast, formatter) {
  "use strict";

  return Controller.extend("hr.fiori.controller.HRShiftConfig", {
    formatter: formatter,

    onInit: function () { this._oFormModel = new JSONModel({}); },

    _openCreate: function (sEntity, sTitle, aFields, oDefaults) {
      var oData = Object.assign({}, oDefaults);
      this._oFormModel.setData(oData);
      var that = this;
      var aControls = aFields.map(function (f) {
        var oCtrl = f.type === "bool"
          ? new CheckBox({ selected: "{oForm>/" + f.key + "}" })
          : new Input({ value: "{oForm>/" + f.key + "}", type: f.type === "number" ? "Number" : "Text" });
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

    onAddTemplate: function () {
      this._openCreate("ShiftTemplates", "Add Shift Template", [
        { key: "code", label: "Code", required: true },
        { key: "name", label: "Name", required: true },
        { key: "startTime", label: "Start (HH:mm)", required: true },
        { key: "endTime", label: "End (HH:mm)", required: true },
        { key: "crossesMidnight", label: "Crosses Midnight", type: "bool" },
        { key: "color", label: "Color (#hex)" },
        { key: "active", label: "Active", type: "bool" }
      ], { crossesMidnight: false, color: "#2196F3", active: true });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
