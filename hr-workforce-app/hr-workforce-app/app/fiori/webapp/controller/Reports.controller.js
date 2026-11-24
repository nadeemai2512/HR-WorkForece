sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "hr/fiori/model/odata"
], function (Controller, Filter, FilterOperator, MessageToast, odata) {
  "use strict";

  return Controller.extend("hr.fiori.controller.Reports", {

    _fetchAll: function (sEntity, aCols) {
      var oBinding = this.getView().getModel().bindList("/" + sEntity);
      return oBinding.requestContexts(0, 10000).then(function (aCtx) {
        return aCtx.map(function (c) { return c.getObject(); });
      });
    },

    onExportOvertime: function () {
      var that = this;
      this._fetchAll("OvertimeRequests").then(function (aRows) {
        odata.exportToCsv("overtime-summary.csv",
          ["employeeNo", "workDate", "otStart", "otEnd", "otHours", "otType", "multiplier", "estimatedAmount", "compOffCredits", "status"],
          aRows);
        MessageToast.show("Overtime summary exported.");
      });
    },

    onExportLeaveUtil: function () {
      this._fetchAll("LeaveBalances").then(function (aRows) {
        odata.exportToCsv("leave-utilization.csv",
          ["employee_ID", "leaveType_code", "totalEntitlement", "used", "pending", "available"], aRows);
        MessageToast.show("Leave utilization exported.");
      });
    },

    onExportUnpaidLeave: function () {
      this._fetchAll("LeaveRequests").then(function (aRows) {
        var aUnpaid = aRows.filter(function (r) { return r.leaveType_code === "EL" && r.status === "APPROVED" && Number(r.days) > 0; });
        odata.exportToCsv("unpaid-leave.csv",
          ["employeeNo", "leaveType_code", "startDate", "endDate", "days", "status"], aUnpaid);
        MessageToast.show("Unpaid leave exported.");
      });
    },

    onExportAttendance: function () {
      this._fetchAll("ShiftAssignments").then(function (aRows) {
        odata.exportToCsv("department-attendance.csv",
          ["employeeNo", "department_code", "shiftDate", "template_code", "startTime", "endTime", "status"], aRows);
        MessageToast.show("Attendance exported.");
      });
    },

    onExportPayroll: function () {
      this._fetchAll("OvertimeRequests").then(function (aRows) {
        var aPayroll = aRows
          .filter(function (r) { return r.status === "APPROVED"; })
          .map(function (r) {
            return Object.assign({}, r, {
              payrollAmount: Number(r.estimatedAmount),
              amountStatus: "APPROVED_PAYROLL",
              note: "Approved payroll amount (distinct from estimated)"
            });
          });
        odata.exportToCsv("payroll-overtime.csv",
          ["employeeNo", "workDate", "otHours", "otType", "multiplier", "estimatedAmount", "payrollAmount", "amountStatus", "note"],
          aPayroll);
        MessageToast.show("Payroll-ready overtime exported (approved only).");
      });
    },

    onExportCompliance: function () {
      this._fetchAll("EmployeeWorkHours").then(function (aRows) {
        odata.exportToCsv("compliance-workhours.csv",
          ["employee_ID", "workDate", "weekKey", "quarterKey", "regularMinutes", "otMinutes", "totalHours"], aRows);
        MessageToast.show("Compliance report exported.");
      });
    },

    onNavBack: function () { this.getOwnerComponent().getRouter().navTo("managerDashboard"); }
  });
});
