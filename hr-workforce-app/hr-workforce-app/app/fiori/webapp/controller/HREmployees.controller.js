sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "hr/fiori/model/odata"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.HREmployees", {

    onInit: function () {
      this._oDialogModel = new JSONModel(this._blankEmployee());
      this.getView().setModel(this._oDialogModel, "empForm");
    },

    _blankEmployee: function () {
      return {
        employeeNo: "", firstName: "", lastName: "", email: "",
        department_code: "", manager_ID: "", jobTitle: "", roleCategory: "EMPLOYEE",
        jurisdiction: "IN-DEFAULT", baseHourlyRate: 0, weeklyRegularHours: 48,
        hireDate: new Date().toISOString().substring(0, 10), status: "ACTIVE"
      };
    },

    onFilterChange: function () {
      var aFilters = [];
      var sDept = this.byId("deptFilter").getSelectedKey();
      var sStatus = this.byId("statusFilter").getSelectedKey();
      var sSearch = this.byId("search").getValue();
      if (sDept && sDept !== "ALL") { aFilters.push(new Filter("department_code", FilterOperator.EQ, sDept)); }
      if (sStatus && sStatus !== "ALL") { aFilters.push(new Filter("status", FilterOperator.EQ, sStatus)); }
      if (sSearch) { aFilters.push(new Filter("fullName", FilterOperator.Contains, sSearch)); }
      this.byId("empTable").getBinding("items").filter(aFilters);
    },

    onCreate: function () {
      this._bEditing = false;
      this._oDialogModel.setData(this._blankEmployee());
      this._openDialog("Create Employee");
    },

    onEdit: function (oEvent) {
      this._bEditing = true;
      var oCtx = oEvent.getSource().getBindingContext();
      this._sEditId = oCtx.getProperty("employeeNo");
      var oData = Object.assign(this._blankEmployee(), oCtx.getObject());
      this._oDialogModel.setData(oData);
      this._openDialog("Edit Employee " + this._sEditId);
    },

    _openDialog: function (sTitle) {
      if (!this._oDialog) {
        this._oDialog = sap.ui.xmlfragment(this.getView().getId(), "hr.fiori.fragment.EmployeeDialog", this);
        this.getView().addDependent(this._oDialog);
      }
      this._oDialog.setTitle(sTitle);
      this._oDialog.open();
    },

    onSaveEmployee: function () {
      var oData = this._oDialogModel.getData();
      if (!oData.employeeNo || !oData.firstName || !oData.lastName || !oData.email) {
        MessageBox.error("Employee No, First Name, Last Name and Email are required.");
        return;
      }
      oData.fullName = (oData.firstName + " " + oData.lastName);
      var oModel = this.getView().getModel();
      var that = this;
      if (this._bEditing) {
        // Update existing employee by key.
        var sPath = "/Employees('" + this._sEditId + "')";
        this.getView().setBusy(true);
        oModel.bindContext(sPath).setProperty("firstName", oData.firstName);
        var oCtx = oModel.bindContext(sPath);
        ["lastName", "fullName", "email", "department_code", "manager_ID", "jobTitle",
         "roleCategory", "jurisdiction", "baseHourlyRate", "weeklyRegularHours", "hireDate", "status"]
          .forEach(function (f) { oCtx.setProperty(f, oData[f]); });
        oCtx.submit("$auto").then(function () {
          MessageToast.show("Employee updated.");
          that._oDialog.close();
          that.byId("empTable").getBinding("items").refresh();
        }).catch(function (e) {
          MessageBox.error("Update failed: " + (e && e.message));
        }).finally(function () { that.getView().setBusy(false); });
      } else {
        var oList = oModel.bindList("/Employees");
        var oNew = oList.create(oData);
        this.getView().setBusy(true);
        oNew.created().then(function () {
          MessageToast.show("Employee created.");
          that._oDialog.close();
        }).catch(function (e) {
          MessageBox.error("Create failed: " + (e && e.message));
        }).finally(function () { that.getView().setBusy(false); });
      }
    },

    onCancelEmployee: function () { this._oDialog.close(); },

    onToggleStatus: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext();
      var sCurrent = oCtx.getProperty("status");
      var sNew = sCurrent === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      var oModel = this.getView().getModel();
      var that = this;
      this.getView().setBusy(true);
      oCtx.setProperty("status", sNew);
      oCtx.submit("$auto").then(function () {
        MessageToast.show("Employee " + sNew.toLowerCase() + ".");
      }).catch(function (e) {
        MessageBox.error("Status change failed: " + (e && e.message));
      }).finally(function () { that.getView().setBusy(false); });
    },

    onExport: function () {
      var oBinding = this.byId("empTable").getBinding("items");
      oBinding.requestContexts(0, 1000).then(function (aCtx) {
        var aRows = aCtx.map(function (c) { return c.getObject(); });
        odata.exportToCsv("employees.csv",
          ["employeeNo", "fullName", "department_code", "jobTitle", "roleCategory", "manager_ID", "status"],
          aRows);
      });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
