'use strict';
/**
 * audit.js — immutable audit log writer. Every state-changing business action
 * (submission, approval, balance adjustment, swap, override, policy change)
 * calls writeAudit so the audit trail is complete and tamper-evident.
 */
const cds = require('@sap/cds');

async function writeAudit(srv, { userId, action, entityType, entityId, prevValue, newValue, reason }) {
    await srv.run(INSERT.into('AuditLogs').entries({
        userId: userId || 'system',
        action,
        entityType,
        entityId: entityId ? String(entityId) : '',
        prevValue: prevValue == null ? '' : (typeof prevValue === 'string' ? prevValue : JSON.stringify(prevValue)),
        newValue: newValue == null ? '' : (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)),
        reason: reason || '',
    }));
}

module.exports = { writeAudit };
