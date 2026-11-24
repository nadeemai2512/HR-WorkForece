sap.ui.define([], function () {
    "use strict";

    return {
        /** Leave request / overtime status -> sap.m.ValueState for ObjectStatus / icons. */
        statusValueState: function (sStatus) {
            switch (sStatus) {
                case "Approved": return "Success";
                case "Rejected":
                case "Cancelled": return "Error";
                case "PendingManager":
                case "PendingPeer": return "Warning";
                case "SentBack": return "Information";
                default: return "None";
            }
        },

        statusIcon: function (sStatus) {
            switch (sStatus) {
                case "Approved": return "sap-icon://accept";
                case "Rejected": return "sap-icon://decline";
                case "Cancelled": return "sap-icon://cancel";
                case "PendingManager":
                case "PendingPeer": return "sap-icon://pending";
                case "SentBack": return "sap-icon://undo";
                case "Submitted": return "sap-icon://outbox";
                default: return "sap-icon://document";
            }
        },

        /** Minutes -> "Xh YYm" readable string. */
        minutesToText: function (iMinutes) {
            if (iMinutes == null) return "";
            var i = parseInt(iMinutes, 10) || 0;
            var h = Math.floor(i / 60);
            var m = i % 60;
            if (h === 0) return m + "m";
            if (m === 0) return h + "h";
            return h + "h " + m + "m";
        },

        /** Decimal hours from minutes for chart axes. */
        minutesToHours: function (iMinutes) {
            if (iMinutes == null) return 0;
            return Math.round((parseInt(iMinutes, 10) / 60) * 10) / 10;
        },

        /** Currency formatting for estimated overtime amounts. */
        formatAmount: function (vAmount) {
            if (vAmount == null || vAmount === "") return "";
            var f = parseFloat(vAmount);
            if (isNaN(f)) return vAmount;
            return "₹ " + f.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        /** Day availability for the weekly chart (regular vs overtime). */
        dayLabel: function (dDate) {
            if (!dDate) return "";
            var d = new Date(dDate);
            return d.toLocaleDateString("en-US", { weekday: "short" });
        },

        /** Coverage % -> sap.m.ValueColor for NumericContent.valueColor
         *  (Good / Critical / Neutral / Error). NOT sap.ui.core.ValueState. */
        coverageState: function (iPct) {
            var p = parseFloat(iPct);
            if (isNaN(p)) return "Neutral";
            if (p < 70) return "Error";
            if (p < 90) return "Critical";
            return "Good";
        },

        /** Severity -> value state for compliance alerts. */
        severityState: function (sSeverity) {
            switch (sSeverity) {
                case "Critical": return "Error";
                case "Warning": return "Warning";
                case "Info":
                default: return "Information";
            }
        },

        /** Trim long text with ellipsis for table cells. */
        truncate: function (sText, iLen) {
            if (!sText) return "";
            var n = parseInt(iLen, 10) || 60;
            return sText.length > n ? sText.slice(0, n) + "…" : sText;
        },

        /** Combine firstName + lastName fallback when fullName is null. */
        fullName: function (sFirst, sLast, sFull) {
            if (sFull) return sFull;
            return [sFirst, sLast].filter(Boolean).join(" ");
        },

        /** Boolean -> Yes/No. */
        yesNo: function (b) { return b ? "Yes" : "No"; }
    };
});
