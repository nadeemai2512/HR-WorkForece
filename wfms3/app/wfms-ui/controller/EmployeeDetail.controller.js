sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Item",
    "sap/m/Dialog", "sap/m/Button", "sap/m/Input", "sap/m/Select", "sap/m/Label", "sap/m/VBox",
    "sap/m/MessageToast", "sap/m/MessageBox",
    "wfms/ui/model/formatters",
    "wfms/ui/model/odataUtil"
], function (Controller, Item, Dialog, Button, Input, Select, Label, VBox,
    MessageToast, MessageBox, formatters, odataUtil) {
    "use strict";
    return Controller.extend("wfms.ui.controller.EmployeeDetail", {
        formatters: formatters,

        onInit: function () {
            this._oRouter = this.getOwnerComponent().getRouter();
            this._oRouter.getRoute("employeeDetail").attachPatternMatched(function (oEvent) {
                this._sId = oEvent.getParameter("arguments").ID;
                this.getView().bindElement({
                    path: "/Employees(" + this._sId + ")",
                    parameters: { "$expand": "department,manager,skills,leaveBalances,leaveBalances/leaveType" }
                });
            }, this);
        },

        /** Open an edit dialog pre-filled from the bound context, then PATCH. */
        onEdit: function () {
            var that = this;
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { MessageToast.show("No employee loaded"); return; }
            var oData = oCtx.getObject() || {};

            var oFirst = new Input({ value: oData.firstName || "" });
            var oLast = new Input({ value: oData.lastName || "" });
            var oEmail = new Input({ value: oData.email || "" });
            var oPhone = new Input({ value: oData.phone || "" });
            var oDept = new Select();
            oDept.bindItems({ path: "/Departments", template: new Item({ key: "{ID}", text: "{name}" }) });
            // set selected key after items are loaded
            oDept.attachUpdateFinished ? null : null;
            oDept.setSelectedKey(oData.department_ID);
            var oStatus = new Select();
            oStatus.addItem(new Item({ key: "Active", text: "Active" }));
            oStatus.addItem(new Item({ key: "Inactive", text: "Inactive" }));
            oStatus.addItem(new Item({ key: "OnLeave", text: "On Leave" }));
            oStatus.addItem(new Item({ key: "Terminated", text: "Terminated" }));
            oStatus.setSelectedKey(oData.status || "Active");
            var oCat = new Select();
            oCat.addItem(new Item({ key: "Permanent", text: "Permanent" }));
            oCat.addItem(new Item({ key: "Contract", text: "Contract" }));
            oCat.addItem(new Item({ key: "Intern", text: "Intern" }));
            oCat.setSelectedKey(oData.employeeCategory || "Permanent");
            var oCountry = new Input({ value: oData.country || "" });
            var oRegion = new Input({ value: oData.region || "" });
            var oRate = new Input({ value: String(oData.hourlyBaseRate != null ? oData.hourlyBaseRate : "") });

            var oDialog = new Dialog({
                title: "Edit Employee",
                content: new VBox({ items: [
                    new Label({ text: "First Name *" }), oFirst,
                    new Label({ text: "Last Name *" }), oLast,
                    new Label({ text: "Email" }), oEmail,
                    new Label({ text: "Phone" }), oPhone,
                    new Label({ text: "Department" }), oDept,
                    new Label({ text: "Status" }), oStatus,
                    new Label({ text: "Category" }), oCat,
                    new Label({ text: "Country" }), oCountry,
                    new Label({ text: "Region" }), oRegion,
                    new Label({ text: "Hourly Base Rate" }), oRate
                ]}),
                beginButton: new Button({ text: "Save", type: "Emphasized", press: function () {
                    if (!oFirst.getValue() || !oLast.getValue()) {
                        MessageBox.error("First and Last Name are required.");
                        return;
                    }
                    var oPayload = {
                        firstName: oFirst.getValue(),
                        lastName: oLast.getValue(),
                        fullName: oFirst.getValue() + " " + oLast.getValue(),
                        email: oEmail.getValue(),
                        phone: oPhone.getValue(),
                        department_ID: oDept.getSelectedKey(),
                        status: oStatus.getSelectedKey(),
                        employeeCategory: oCat.getSelectedKey(),
                        country: oCountry.getValue(),
                        region: oRegion.getValue(),
                        hourlyBaseRate: parseFloat(oRate.getValue()) || 0
                    };
                    odataUtil.update("Employees", that._sId, oPayload).then(function () {
                        that.getView().getModel().refresh();
                        MessageToast.show("Employee updated");
                        oDialog.close();
                    }).catch(function (e) { MessageBox.error(e.message || e); });
                }}),
                endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
                afterClose: function () { oDialog.destroy(); }
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        onNavBack: function () { this._oRouter.navTo("employeeManage", {}, true); }
    });
});
