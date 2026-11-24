sap.ui.define([
  "sap/ui/core/mvc/Controller"
], function (Controller) {
  "use strict";

  return Controller.extend("hr.fiori.controller.App", {
    onInit: function () {
      // apply content density class to the root
      this.getView().addStyleClass(this.getOwnerComponent().getContentDensityClass());
    }
  });
});
