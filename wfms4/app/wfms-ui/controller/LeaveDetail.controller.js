sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "wfms/ui/model/formatters"
], function (Controller, MessageBox, MessageToast, formatters) {
    "use strict";

    var ACTION_BASE = "/odata/v4/workforce";

    return Controller.extend("wfms.ui.controller.LeaveDetail", {
        formatters: formatters,

        onInit: function () {
            this._oRouter = this.getOwnerComponent().getRouter();
            this._oRouter.getRoute("leaveDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sId = oEvent.getParameter("arguments").ID;
            this.getView().bindElement({
                path: "/LeaveRequests(" + sId + ")",
                parameters: {
                    "$expand": "employee,leaveType,approver,attachments,approvalHistory"
                }
            });
        },

        _callAction: function (sAction, oPayload, sMsg) {
            var that = this;
            fetch(ACTION_BASE + "/" + sAction, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(oPayload)
            }).then(function (r) {
                if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); });
                return r.json();
            }).then(function () {
                that.getView().getModel().refresh();
                MessageToast.show(sMsg);
            }).catch(function (e) {
                MessageBox.error(e.message || e);
            });
        },

        onSubmit: function () {
            this._callAction("submitLeaveRequest", { ID: this._currentId() }, "Leave request submitted");
        },
        onApprove: function () {
            var that = this;
            MessageBox.confirm("Approve this leave request?", {
                title: "Approve Leave",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;
                    that._callAction("approveLeaveRequest",
                        { ID: that._currentId(), comments: "Approved", coverageOverride: false, coverageOverrideReason: "" },
                        "Leave approved");
                }
            });
        },
        onReject: function () { this._callAction("rejectLeaveRequest", { ID: this._currentId(), comments: "Rejected" }, "Leave rejected"); },
        onSendBack: function () { this._callAction("sendBackLeaveRequest", { ID: this._currentId(), comments: "Sent back for revision" }, "Leave sent back"); },
        onCancel: function () { this._callAction("cancelLeaveRequest", { ID: this._currentId() }, "Leave cancelled"); },

        _currentId: function () {
            return this.getView().getElementBinding().getPath().match(/\((.+)\)/)[1];
        },

        onNavBack: function () { this._oRouter.navTo("leaveList", {}, true); }
    });
});
