sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "wfms/ui/model/formatters"
], function (Controller, formatters) {
    "use strict";
    return Controller.extend("wfms.ui.controller.EmployeeDetail", {
        formatters: formatters,
        onInit: function () {
            this._oRouter = this.getOwnerComponent().getRouter();
            this._oRouter.getRoute("employeeDetail").attachPatternMatched(function (oEvent) {
                var sId = oEvent.getParameter("arguments").ID;
                this.getView().bindElement({
                    path: "/Employees(" + sId + ")",
                    parameters: { "$expand": "department,manager,skills,leaveBalances,leaveBalances/leaveType" }
                });
            }, this);
        },
        onNavBack: function () { this._oRouter.navTo("employeeManage", {}, true); }
    });
});
