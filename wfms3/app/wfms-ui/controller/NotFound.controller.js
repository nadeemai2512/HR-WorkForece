sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
    "use strict";
    return Controller.extend("wfms.ui.controller.NotFound", {
        onInit: function () {},
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("employeeDashboard", {}, true); }
    });
});
