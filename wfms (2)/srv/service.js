/**
 * wfms/srv/WorkforceService.js
 *
 * Main service entry point. CAP auto-loads this file because its name matches
 * the service defined in service.cds. Uses CAP's canonical "with" handler
 * pattern: export a function that receives the already-initialized service
 * and delegates to per-domain handler modules.
 */
const registerLeave = require('./leave-service');
const registerShift = require('./shift-service');
const registerOvertime = require('./overtime-service');
const registerHR = require('./hr-service');
const registerAudit = require('./audit-service');

module.exports = (srv) => {
    console.log('[WFMS] WorkforceService handler registration starting');
    registerLeave(srv);
    registerShift(srv);
    registerOvertime(srv);
    registerHR(srv);
    registerAudit(srv);
    console.log('[WFMS] WorkforceService handler registration complete');
};
