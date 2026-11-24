sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/Device"
], function (JSONModel, Device) {
  "use strict";

  return {
    createDeviceModel: function () {
      var oModel = new JSONModel(Device);
      oModel.setDefaultBindingMode("OneWay");
      return oModel;
    },

    createAppViewModel: function () {
      // Holds transient UI state: current employee number (resolved from backend),
      // dashboard KPIs, selected filters, busy flags.
      return new JSONModel({
        currentUserNo: null,
        currentRole: null,
        employeeDashboard: {},
        managerDashboard: {},
        busy: false
      });
    }
  };
});
