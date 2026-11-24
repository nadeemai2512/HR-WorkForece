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
            // The OData V4 model is declared as the default (unnamed) model in
            // manifest.json (sap.ui5.models[""]), so declarative bindings in the XML
            // views — absolute paths like {/LeaveRequests} and relative paths like
            // {availableEL} (resolved through bindElement) — bind against it directly.
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
