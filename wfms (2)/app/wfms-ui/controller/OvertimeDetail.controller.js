sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters"
], function (Controller, MessageBox, MessageToast, formatters) {
    "use strict";
    var ACTION_BASE = "/odata/v4/workforce";
    return Controller.extend("wfms.ui.controller.OvertimeDetail", {
        formatters: formatters,
        onInit: function () {
            this._oRouter = this.getOwnerComponent().getRouter();
            this._oRouter.getRoute("overtimeDetail").attachPatternMatched(function (oEvent) {
                var sId = oEvent.getParameter("arguments").ID;
                this.getView().bindElement({
                    path: "/OvertimeRequests(" + sId + ")",
                    parameters: { "$expand": "employee,employee/department,approver" }
                });
            }, this);
        },
        _call: function (sAction, oPayload, sMsg) {
            var that = this;
            fetch(ACTION_BASE + "/" + sAction, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(oPayload) })
                .then(function (r) { if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); }); return r.json(); })
                .then(function () { that.getView().getModel("main").refresh(); MessageToast.show(sMsg); })
                .catch(function (e) { MessageBox.error(e.message || e); });
        },
        _id: function () { return this.getView().getElementBinding().getPath().match(/\((.+)\)/)[1]; },
        onSubmit: function () { this._call("submitOvertime", { ID: this._id() }, "Overtime submitted"); },
        onApprove: function () { this._call("approveOvertime", { ID: this._id(), comments: "Approved" }, "Overtime approved"); },
        onReject: function () { this._call("rejectOvertime", { ID: this._id(), comments: "Rejected" }, "Overtime rejected"); },
        onSendBack: function () { this._call("sendBackOvertime", { ID: this._id(), comments: "Sent back" }, "Overtime sent back"); },
        onCancel: function () { this._call("cancelOvertime", { ID: this._id() }, "Overtime cancelled"); },
        onNavBack: function () { this._oRouter.navTo("overtimeList", {}, true); }
    });
});
