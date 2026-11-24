sap.ui.define(["sap/ui/core/mvc/Controller", "wfms/ui/model/formatters"], function (Controller, formatters) {
    "use strict";
    return Controller.extend("wfms.ui.controller.PolicyConfig", {
        formatters: formatters,
        onInit: function () {},
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("hrDashboard", {}, true); }
    });
});
