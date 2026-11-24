sap.ui.define([], function () {
  "use strict";

  return {
    /** Convert a status string into a sap.m.ValueState for visual indicators. */
    statusState: function (sStatus) {
      switch ((sStatus || "").toUpperCase()) {
        case "APPROVED":        return "Success";
        case "REJECTED":
        case "CANCELLED":       return "Error";
        case "PENDING_MANAGER":
        case "PENDING_PEER":
        case "SUBMITTED":
        case "SENT_BACK":       return "Warning";
        case "DRAFT":           return "None";
        default:                return "None";
      }
    },

    /** Human-readable status text. */
    statusText: function (sStatus) {
      var map = {
        DRAFT: "Draft", SUBMITTED: "Submitted", PENDING_MANAGER: "Pending Approval",
        PENDING_PEER: "Pending Peer", APPROVED: "Approved", REJECTED: "Rejected",
        SENT_BACK: "Sent Back", CANCELLED: "Cancelled", ASSIGNED: "Assigned",
        SWAPPED: "Swapped"
      };
      return map[(sStatus || "").toUpperCase()] || sStatus || "";
    },

    /** Format a leave-type code to a readable name. */
    leaveTypeText: function (sCode) {
      var map = { EL: "Earned Leave", SL: "Sick Leave", CL: "Casual Leave", COMP: "Comp-Off" };
      return map[sCode] || sCode || "";
    },

    /** Format overtime type. */
    otTypeText: function (sType) {
      var map = { WEEKDAY: "Weekday", WEEKEND: "Weekend / Rest Day", HOLIDAY: "Public Holiday" };
      return map[sType] || sType || "";
    },

    /** Combine firstName + lastName fallback when fullName is empty. */
    fullName: function (sFirst, sLast, sFull) {
      return sFull || [sFirst, sLast].filter(Boolean).join(" ");
    },

    /** Format minutes as "H:mm". */
    minutesToHours: function (iMinutes) {
      if (iMinutes == null) return "0:00";
      var h = Math.floor(iMinutes / 60);
      var m = iMinutes % 60;
      return h + ":" + (m < 10 ? "0" + m : m);
    },

    /** Format a decimal currency-like value with 2 decimals. */
    money: function (vValue) {
      if (vValue == null) return "0.00";
      return Number(vValue).toFixed(2);
    },

    /** Yes/No text for booleans. */
    boolText: function (bValue) {
      return bValue ? "Yes" : "No";
    },

    /** Build a PlanningCalendar appointment title for a shift. */
    shiftTitle: function (sEmpNo, sTemplate, sStart, sEnd) {
      return [sEmpNo, sTemplate, (sStart || "") + "-" + (sEnd || "")].filter(Boolean).join(" · ");
    },

    /** Combine a shiftDate (yyyy-mm-dd) + startTime (HH:mm) into a JS Date. */
    shiftStart: function (sDate, sStart) {
      if (!sDate || !sStart) { return null; }
      return new Date(sDate + "T" + sStart + ":00");
    },

    /** Combine shiftDate + endTime into a JS Date, advancing one day when crossesMidnight. */
    shiftEnd: function (sDate, sEnd, bCrossesMidnight) {
      if (!sDate || !sEnd) { return null; }
      var oDate = new Date(sDate + "T" + sEnd + ":00");
      if (bCrossesMidnight) { oDate.setDate(oDate.getDate() + 1); }
      return oDate;
    },

    /** Map a shift template code to a PlanningCalendarAppointmentType for colour coding. */
    appointmentType: function (sCode) {
      switch ((sCode || "").toUpperCase()) {
        case "MORNING": return "Type_07";
        case "GENERAL": return "Type_06";
        case "NIGHT":   return "Type_09";
        default:        return "Type_01";
      }
    }
  };
});
