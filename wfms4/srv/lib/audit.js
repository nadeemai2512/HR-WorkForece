/**
 * wfms/srv/lib/audit.js
 * Thin helpers for writing immutable audit + approval-history rows inside the
 * caller's transaction. All workflow transitions and HR policy changes go
 * through these so the audit trail is always complete.
 */
const cds = require('@sap/cds');
const { INSERT, SELECT } = cds.ql;

/** Current user id from req.user (mock or XSUAA JWT). */
function userId(req) {
    const u = req && req.user;
    if (!u) return 'system';
    return u.id || u.email || u.name || 'system';
}

async function writeAudit(tx, req, action, entityType, entityID, prev, next, comments = '') {
    await tx.run(INSERT.into('wfms.AuditLogs').entries({
        userId: userId(req),
        action,
        entityType,
        entityID: String(entityID || ''),
        previousValue: prev == null ? '' : (typeof prev === 'string' ? prev : JSON.stringify(prev)),
        newValue: next == null ? '' : (typeof next === 'string' ? next : JSON.stringify(next)),
        comments: comments || ''
    }));
}

async function writeApprovalHistory(tx, entityType, entityID, approver, action, decision, comments = '') {
    await tx.run(INSERT.into('wfms.ApprovalHistory').entries({
        entityType, entityID, approver: approver || 'system',
        action, decision, comments: comments || ''
    }));
}

/** Resolve the authenticated user's Employee ID (by email = req.user.id).
 *  Used to populate the `approver` association on approved leave / overtime
 *  requests so the detail pages can bind {approver/fullName}. Returns null
 *  if no employee row is linked (e.g. an HR admin without an employee record). */
async function currentEmployeeId(tx, req) {
    const id = userId(req);
    const emp = await tx.run(SELECT.one.from('wfms.Employees').where `email = ${id}`);
    return emp ? emp.ID : null;
}

module.exports = { userId, writeAudit, writeApprovalHistory, currentEmployeeId };
