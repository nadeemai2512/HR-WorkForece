sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "wfms/ui/model/formatters",
    "wfms/ui/model/odataUtil"
], function (Controller, MessageToast, MessageBox, formatters, odataUtil) {
    "use strict";
    var ACTION_BASE = "/odata/v4/workforce";
    return Controller.extend("wfms.ui.controller.ShiftSwap", {
        formatters: formatters,
        onInit: function () {},
        onSubmit: function () {
            var sShift = this.byId("myShift").getSelectedKey();
            var sTarget = this.byId("targetEmp").getSelectedKey();
            var sReason = this.byId("reason").getValue();
            if (!sShift || !sTarget) { MessageBox.error("Select your shift and a colleague to swap with."); return; }
            var that = this;
            // Resolve the requestor from the selected shift's employee. The OData
            // V4 model has no .read(); use the fetch-based helper for the single
            // entity lookup, then POST the swap request and call submitShiftSwap.
            odataUtil.readOne("/ShiftAssignments(" + sShift + ")?$select=employee_ID")
                .then(function (oShift) {
                    var oPayload = {
                        requestor_ID: oShift.employee_ID, // backend re-validates via auth context
                        requestorShift_ID: sShift,
                        targetEmployee_ID: sTarget,
                        targetShift_ID: null,
                        status: "Submitted",
                        reason: sReason
                    };
                    return fetch(ACTION_BASE + "/ShiftSwapRequests", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify(oPayload)
                    }).then(function (r) {
                        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); });
                        return r.json();
                    }).then(function (oCreated) {
                        // call submitShiftSwap action which validates skills, availability, rest period
                        return fetch(ACTION_BASE + "/submitShiftSwap", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ ID: oCreated.ID })
                        }).then(function (rs) {
                            if (!rs.ok) return rs.json().then(function (e) { throw new Error(e.error && e.error.message || rs.statusText); });
                            return oCreated;
                        });
                    });
                })
                .then(function () {
                    that.getView().getModel("main").refresh();
                    MessageToast.show("Shift swap request submitted");
                })
                .catch(function (e) {
                    MessageBox.error("Could not submit swap: " + (e.message || e));
                });
        },
        _call: function (sAction, sId, sMsg) {
            var that = this;
            fetch(ACTION_BASE + "/" + sAction, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ID: sId, comments: "" }) })
                .then(function (r) { if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); }); return r.json(); })
                .then(function () { that.getView().getModel("main").refresh(); MessageToast.show(sMsg); })
                .catch(function (e) { MessageBox.error(e.message || e); });
        },
        onPeerAccept: function (oEvent) { this._call("peerAcceptSwap", oEvent.getSource().getBindingContext().getProperty("ID"), "Swap accepted"); },
        onPeerReject: function (oEvent) { this._call("peerRejectSwap", oEvent.getSource().getBindingContext().getProperty("ID"), "Swap rejected"); },
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("employeeDashboard", {}, true); }
    });
});
