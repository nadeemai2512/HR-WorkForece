sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "wfms/ui/model/models"
], function (UIComponent, Device, models) {
    "use strict";

    return UIComponent.extend("wfms.ui.Component", {
        metadata: { manifest: "json" },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.setModel(models.createDeviceModel(), "device");
            // A lightweight JSON model for UI state (current user, filters, dialog state)
            this.setModel(models.createUIStateModel(), "ui");
            this.getRouter().initialize();
        },

        getContentDensityClass: function () {
            if (!this._sContentDensityClass) {
                if (!Device.support.touch) {
                    this._sContentDensityClass = "sapUiSizeCompact";
                } else {
                    this._sContentDensityClass = "sapUiSizeCozy";
                }
            }
            return this._sContentDensityClass;
        }
    });
});
