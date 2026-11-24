sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "wfms/ui/model/formatters"
], function (Controller, Filter, FilterOperator, MessageToast, MessageBox, formatters) {
    "use strict";
    var ACTION_BASE = "/odata/v4/workforce";
    return Controller.extend("wfms.ui.controller.ApprovalInbox", {
        formatters: formatters,
        onInit: function () {
            this._oRouter = this.getOwnerComponent().getRouter();
            this._oRouter.getRoute("approvalInbox").attachPatternMatched(function (oEvent) {
                var sType = oEvent.getParameter("arguments").type || "leave";
                this.byId("approvalTabs").setSelectedKey(sType);
                this._applyFilters();
            }, this);
        },
        onTabSelect: function () { this._applyFilters(); },
        _applyFilters: function () {
            var sKey = this.byId("approvalTabs").getSelectedKey();
            var oView = this.getView();
            // The IconTabFilter tables are children; filter their bindings to PendingManager
            // (and swap to PendingManager too) so the inbox shows actionable items.
            var aTables = oView.findAggregatedObjects(true, function (o) { return o.isA && o.isA("sap.m.Table"); });
            aTables.forEach(function (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) oBinding.filter(new Filter("status", FilterOperator.EQ, "PendingManager"));
            });
        },
        _call: function (sAction, oPayload, sMsg) {
            var that = this;
            fetch(ACTION_BASE + "/" + sAction, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(oPayload) })
                .then(function (r) { if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); }); return r.json(); })
                .then(function () { that.getView().getModel().refresh(); MessageToast.show(sMsg); })
                .catch(function (e) { MessageBox.error(e.message || e); });
        },
        onApproveLeave: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext().getProperty("ID");
            this._call("approveLeaveRequest", { ID: sId, comments: "Approved", coverageOverride: false, coverageOverrideReason: "" }, "Leave approved");
        },
        onRejectLeave: function (oEvent) { this._call("rejectLeaveRequest", { ID: oEvent.getSource().getBindingContext().getProperty("ID"), comments: "Rejected" }, "Leave rejected"); },
        onLeaveDetail: function (oEvent) { this._oRouter.navTo("leaveDetail", { ID: oEvent.getSource().getBindingContext().getProperty("ID") }); },
        onApproveOt: function (oEvent) { this._call("approveOvertime", { ID: oEvent.getSource().getBindingContext().getProperty("ID"), comments: "Approved" }, "Overtime approved"); },
        onRejectOt: function (oEvent) { this._call("rejectOvertime", { ID: oEvent.getSource().getBindingContext().getProperty("ID"), comments: "Rejected" }, "Overtime rejected"); },
        onApproveSwap: function (oEvent) { this._call("approveShiftSwap", { ID: oEvent.getSource().getBindingContext().getProperty("ID"), comments: "Approved" }, "Swap approved"); },
        onRejectSwap: function (oEvent) { this._call("rejectShiftSwap", { ID: oEvent.getSource().getBindingContext().getProperty("ID"), comments: "Rejected" }, "Swap rejected"); },
        onNavBack: function () { this._oRouter.navTo("managerDashboard", {}, true); }
    });
});
