sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Item",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/Dialog", "sap/m/Button", "sap/m/Input", "sap/m/Select", "sap/m/Label", "sap/m/VBox",
    "sap/m/MessageToast", "sap/m/MessageBox",
    "wfms/ui/model/formatters"
], function (Controller, Item, Filter, FilterOperator,
    Dialog, Button, Input, Select, Label, VBox,
    MessageToast, MessageBox, formatters) {
    "use strict";
    var ACTION_BASE = "/odata/v4/workforce";
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
            this.byId("empTable").getBinding("items").filter(a);
        },
        onDeptChange: function () { this.onSearch(); },
        onRefresh: function () { this.getView().getModel("main").refresh(); MessageToast.show("Refreshed"); },
        onItemPress: function (oEvent) {
            var sId = oEvent.getParameter("listItem").getBindingContext().getProperty("ID");
            this.getOwnerComponent().getRouter().navTo("employeeDetail", { ID: sId });
        },
        onCreate: function () { this._openCreateDialog(); },
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
                    new Label({ text: "Employee Number" }), oEmpNo,
                    new Label({ text: "First Name" }), oFirst,
                    new Label({ text: "Last Name" }), oLast,
                    new Label({ text: "Email" }), oEmail,
                    new Label({ text: "Department" }), oDept,
                    new Label({ text: "Hire Date" }), oHire,
                    new Label({ text: "Hourly Base Rate" }), oRate,
                    new Label({ text: "Country" }), oCountry,
                    new Label({ text: "Region" }), oRegion
                ]}),
                beginButton: new Button({ text: "Create", type: "Emphasized", press: function () {
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
                        hourlyBaseRate: parseFloat(oRate.getValue())
                    };
                    fetch(ACTION_BASE + "/Employees", {
                        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                        body: JSON.stringify(oPayload)
                    }).then(function (r) {
                        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error && e.error.message || r.statusText); });
                        return r.json();
                    }).then(function () {
                        that.getView().getModel("main").refresh();
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
        onNavBack: function () { this.getOwnerComponent().getRouter().navTo("hrDashboard", {}, true); }
    });
});
