'use strict';
/**
 * auth.js — authorization helpers.
 *
 * Production: scopes come from XSUAA (xs-security.json): Employee, Manager,
 * HRAdmin. The employeeNo of the logged-in user is carried as a custom XSUAA
 * attribute (`employeeNo`) and read from req.user.attr.
 *
 * Local / mock (cds watch without XSUAA): req.user.id is 'anonymous'; we fall
 * back to MOCK_EMPLOYEE_NO and MOCK_ROLE env vars so the app is fully runnable
 * locally. Tests inject a custom user via cds.test's auth header.
 */
const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const SCOPES = { EMPLOYEE: 'Employee', MANAGER: 'Manager', HRADMIN: 'HRAdmin' };

function scopesOf(req) {
    const u = req?.user || cds.context?.user;
    if (!u) return [];
    let scopes = u.scopes || u.roles;
    if (!scopes) return [];
    if (Array.isArray(scopes)) return scopes;
    if (typeof scopes === 'object') return Object.keys(scopes);
    return [];
}

function hasScope(req, scope) {
    const scopes = scopesOf(req);
    if (!scopes || scopes.length === 0) return false;
    // scopes may arrive as "$XSAPPNAME.Employee"; match by suffix
    return scopes.some(s => s === scope || s.endsWith('.' + scope) || s.endsWith(scope));
}

function roleCategory(req) {
    if (hasScope(req, SCOPES.HRADMIN)) return 'HR_ADMIN';
    if (hasScope(req, SCOPES.MANAGER)) return 'MANAGER';
    if (hasScope(req, SCOPES.EMPLOYEE)) return 'EMPLOYEE';
    // Mock fallback for local dev / tests when no XSUAA scopes are present
    const mock = (process.env.MOCK_ROLE || 'EMPLOYEE').toUpperCase().replace('-', '_');
    return mock === 'HR_ADMIN' ? 'HR_ADMIN' : mock === 'MANAGER' ? 'MANAGER' : 'EMPLOYEE';
}

function userId(req) {
    const u = req?.user || cds.context?.user;
    return u?.id && u.id !== 'anonymous' ? u.id : (process.env.MOCK_USER || 'dev-user');
}

/** Resolve the employeeNo of the current user (from XSUAA attr or mock env). */
function currentEmployeeNo(req) {
    const u = req?.user || cds.context?.user;
    const attr = u?.attr || {};
    if (attr.employeeNo) return attr.employeeNo;
    if (process.env.MOCK_EMPLOYEE_NO) return process.env.MOCK_EMPLOYEE_NO;
    return null;
}

/** Load the Employees row for the current user (DB-level, bypassing service hooks). */
async function currentEmployee(srv, req) {
    const no = currentEmployeeNo(req);
    if (!no) return null;
    return cds.db.run(SELECT.one.from('my.hr.Employees').where({ employeeNo: no }));
}

/** Direct reports of a manager (employees whose manager_ID == managerNo).
 *  Queries the DB entity my.hr.Employees via cds.db to bypass the service-level
 *  READ hooks (otherwise the Employees MANAGER hook would recurse infinitely). */
async function teamMemberIds(srv, managerNo) {
    const rows = await cds.db.run(
        SELECT.from('my.hr.Employees').columns('employeeNo', 'firstName', 'lastName', 'fullName', 'department_code', 'jurisdiction')
            .where({ manager_ID: managerNo, status: 'ACTIVE' })
    );
    return rows;
}

/**
 * Instance-based authorization for accessing another employee's records.
 *  - HR_ADMIN: always allowed
 *  - MANAGER: allowed if target is a direct report
 *  - EMPLOYEE: allowed only if target == self
 */
async function assertCanAccessEmployee(srv, req, targetEmployeeNo) {
    const role = roleCategory(req);
    if (role === 'HR_ADMIN') return true;
    const me = currentEmployeeNo(req);
    if (role === 'EMPLOYEE') {
        if (me !== targetEmployeeNo) {
            cds.error(`403 FORBIDDEN: employees can only access their own records (you=${me}, target=${targetEmployeeNo}).`, { code: 403 });
        }
        return true;
    }
    if (role === 'MANAGER') {
        if (me === targetEmployeeNo) return true; // managers see their own records too
        const team = await teamMemberIds(srv, me);
        if (!team.some(t => t.employeeNo === targetEmployeeNo)) {
            cds.error(`403 FORBIDDEN: ${targetEmployeeNo} is not within your reporting scope.`, { code: 403 });
        }
        return true;
    }
    cds.error(`403 FORBIDDEN: unknown role.`, { code: 403 });
}

module.exports = {
    SCOPES, scopesOf, hasScope, roleCategory, userId,
    currentEmployeeNo, currentEmployee, teamMemberIds, assertCanAccessEmployee,
};
