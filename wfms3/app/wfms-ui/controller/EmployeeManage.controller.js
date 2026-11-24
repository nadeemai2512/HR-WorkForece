sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Item",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/Dialog", "sap/m/Button", "sap/m/Input", "sap/m/Select", "sap/m/Label", "sap/m/VBox",
    "sap/m/MessageToast", "sap/m/MessageBox",
    "wfms/ui/model/formatters",
    "wfms/ui/model/odataUtil"
], function (Controller, Item, Filter, FilterOperator,
    Dialog, Button, Input, Select, Label, VBox,
    MessageToast, MessageBox, formatters, odataUtil) {
    "use strict";
    return Controller.extend("wfms.ui.controller.EmployeeManage", {
        formatters: formatters,
        onInit: function () {},
        onSearch: function () {
            var s = this.byId("searchField").getValue();
            var a = [];
            if (s) {
                a.push(new Filter({ filters: [
                    new Filter("fullName", FilterOperator.Contains, s),
                    new Filter("employeeNumber", FilterOperator.Contains, s)
                ], and: false }));
            }
            var d = this.byId("deptFilter").getSelectedKey();
            if (d) a.push(new Filter("department_ID", FilterOperator.EQ, d));
            var oBinding = this.byId("empTable").getBinding("items");
            if (oBinding) { oBinding.filter(a); }
        },
        onDeptChange: function () { this.onSearch(); },
        onRefresh: function () { this.getView().getModel().refresh(); MessageToast.show("Refreshed"); },
        onItemPress: function (oEvent) {
            var sId = oEvent.getParameter("listItem").getBindingContext().getProperty("ID");
            this.getOwnerComponent().getRouter().navTo("employeeDetail", { ID: sId });
        },
        onCreate: function () { this._openCreateDialog(); },

        _validate: function (oEmpNo, oFirst, oLast, oEmail, oDept) {
            if (!oEmpNo.getValue()) return "Employee Number is required.";
            if (!oFirst.getValue()) return "First Name is required.";
            if (!oLast.getValue()) return "Last Name is required.";
            if (!oEmail.getValue() || oEmail.getValue().indexOf("@") < 0) return "A valid Email is required.";
            if (!oDept.getSelectedKey()) return "Department is required.";
            return null;
        },

        _openCreateDialog: function () {
            var that = this;
            var oEmpNo = new Input({ value: "" });
            var oFirst = new Input({ value: "" });
            var oLast = new Input({ value: "" });
            var oEmail = new Input({ value: "" });
            var oDept = new Select();
            oDept.bindItems({ path: "/Departments", template: new Item({ key: "{ID}", text: "{name}" }) });
            var oHire = new Input({ value: "2026-01-01", placeholder: "YYYY-MM-DD" });
            var oRate = new Input({ value: "500", placeholder: "Hourly base rate" });
            var oCountry = new Input({ value: "IND" });
            var oRegion = new Input({ value: "BLR" });
            var oDialog = new Dialog({
                title: "Create Employee",
                content: new VBox({ items: [
                    new Label({ text: "Employee Number *" }), oEmpNo,
                    new Label({ text: "First Name *" }), oFirst,
                    new Label({ text: "Last Name *" }), oLast,
                    new Label({ text: "Email *" }), oEmail,
                    new Label({ text: "Department *" }), oDept,
                    new Label({ text: "Hire Date" }), oHire,
                    new Label({ text: "Hourly Base Rate" }), oRate,
                    new Label({ text: "Country" }), oCountry,
                    new Label({ text: "Region" }), oRegion
                ]}),
                beginButton: new Button({ text: "Create", type: "Emphasized", press: function () {
                    var sErr = that._validate(oEmpNo, oFirst, oLast, oEmail, oDept);
                    if (sErr) { MessageBox.error(sErr); return; }
                    var oPayload = {
                        employeeNumber: oEmpNo.getValue(),
                        firstName: oFirst.getValue(),
                        lastName: oLast.getValue(),
                        fullName: oFirst.getValue() + " " + oLast.getValue(),
                        email: oEmail.getValue(),
                        department_ID: oDept.getSelectedKey(),
                        status: "Active",
                        employeeCategory: "Permanent",
                        hireDate: oHire.getValue(),
                        country: oCountry.getValue(),
                        region: oRegion.getValue(),
                        hourlyBaseRate: parseFloat(oRate.getValue()) || 0
                    };
                    odataUtil.create("Employees", oPayload).then(function () {
                        that.getView().getModel().refresh();
                        MessageToast.show("Employee created");
                        oDialog.close();
                    }).catch(function (e) { MessageBox.error(e.message || e); });
                }}),
                endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
                afterClose: function () { oDialog.destroy(); }
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        /** Per-row delete (the trash button in the Actions column). */
        onDelete: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext();
            var sId = oCtx.getProperty("ID");
            var sName = oCtx.getProperty("fullName");
            var that = this;
            MessageBox.confirm("Delete employee " + (sName || sId) + "? This cannot be undone.", {
                title: "Confirm Delete",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) return;
                    odataUtil.remove("Employees", sId).then(function () {
                        that.getView().getModel().refresh();
                        MessageToast.show("Employee deleted");
                    }).catch(function (e) { MessageBox.error(e.message || e); });
                }
            });
        },

        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("hrDashboard", {}, true); }
    });
});
