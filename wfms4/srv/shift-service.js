/**
 * wfms/srv/shift-service.js
 *
 * Shift assignment validation (rest period) and shift-swap workflow
 * (submit -> peer accept/reject -> manager approve/reject).
 */
const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const calc = require('./lib/calculations');
const { writeAudit, writeApprovalHistory, userId } = require('./lib/audit');

module.exports = (srv) => {

        /* ---------------- ShiftAssignment CREATE: rest period + overnight ---------------- */
        srv.before('CREATE', 'ShiftAssignments', async (req) => {
            const tx = cds.tx(req);
            const data = req.data;
            const emp = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: data.employee_ID }));
            if (!emp) return req.error(404, 'Employee not found');

            const tpl = await tx.run(SELECT.one.from('wfms.ShiftTemplates').where({ ID: data.shiftTemplate_ID }));
            if (!tpl) return req.error(404, 'Shift template not found');
            if (!tpl.active) return req.error(400, 'Shift template is inactive');

            // materialize start/end from template if not provided
            data.startTime = data.startTime || tpl.startTime;
            data.endTime = data.endTime || tpl.endTime;

            // duplicate assignment on same date
            const dup = await tx.run(SELECT.one.from('wfms.ShiftAssignments')
                .where `employee_ID = ${data.employee_ID} and assignmentDate = ${data.assignmentDate} and status not in ('Cancelled')`);
            if (dup) return req.error(409, `Employee already has a shift on ${data.assignmentDate} (${dup.startTime}-${dup.endTime}).`);

            // rest period
            const restMsg = await calc.validateRestPeriod(tx, data.employee_ID, data.assignmentDate, data.startTime, data.endTime);
            if (restMsg) {
                // block hard violations
                return req.error(422, restMsg);
            }
            data.restViolation = false;
        });

        /* ---------------- submitShiftSwap ---------------- */
        srv.on('submitShiftSwap', async (req) => {
            const tx = cds.tx(req);
            const swap = await tx.run(SELECT.one.from('wfms.ShiftSwapRequests').where({ ID: req.data.ID }));
            if (!swap) return req.error(404, 'Swap request not found');
            if (swap.status !== 'Submitted') return req.error(409, `Cannot submit a swap in status ${swap.status}`);

            const requestor = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: swap.requestor_ID }));
            const target = await tx.run(SELECT.one.from('wfms.Employees').where({ ID: swap.targetEmployee_ID }));
            if (!target) return req.error(404, 'Target employee not found');
            if (target.status !== 'Active') return req.error(400, 'Target employee is not active');
            if (swap.requestor_ID === swap.targetEmployee_ID) return req.error(400, 'Cannot swap with yourself');

            // skill match: both employees must share at least one primary skill
            const rSkills = await tx.run(SELECT.from('wfms.EmployeeSkills').where({ employee_ID: swap.requestor_ID }));
            const tSkills = await tx.run(SELECT.from('wfms.EmployeeSkills').where({ employee_ID: swap.targetEmployee_ID }));
            const rSkillSet = new Set(rSkills.map(s => s.skill));
            const shared = tSkills.some(s => rSkillSet.has(s.skill));
            if (!shared) return req.error(422, 'Target employee does not share any required skill with the requestor.');

            // target availability: no approved leave on the requestor shift date, no conflicting shift
            const rs = await tx.run(SELECT.one.from('wfms.ShiftAssignments').where({ ID: swap.requestorShift_ID }));
            if (!rs) return req.error(404, 'Requestor shift not found');
            const onLeave = await tx.run(SELECT.one.from('wfms.LeaveRequests')
                .where `employee_ID = ${swap.targetEmployee_ID} and status = 'Approved' and startDate <= ${rs.assignmentDate} and endDate >= ${rs.assignmentDate}`);
            if (onLeave) return req.error(422, `Target employee is on approved leave on ${rs.assignmentDate}.`);
            const conflict = await tx.run(SELECT.one.from('wfms.ShiftAssignments')
                .where `employee_ID = ${swap.targetEmployee_ID} and assignmentDate = ${rs.assignmentDate} and status not in ('Cancelled')`);
            if (conflict) return req.error(422, `Target employee already has a shift on ${rs.assignmentDate}.`);

            // rest period for target taking the requestor's shift
            const restMsg = await calc.validateRestPeriod(tx, swap.targetEmployee_ID, rs.assignmentDate, rs.startTime, rs.endTime);
            if (restMsg) {
                // Auto-reject in a SEPARATE transaction: returning req.error rolls
                // back the request's own tx, so persisting the reject + audit inside
                // it would be undone. Commit them independently, then surface the error.
                const tx2 = cds.tx({ user: req.user });
                try {
                    await tx2.run(UPDATE('wfms.ShiftSwapRequests').set({ status: 'Rejected', eligibilityNotes: restMsg, managerComments: 'Auto-rejected: rest period violation for target.' }).where({ ID: swap.ID }));
                    await writeAudit(tx2, req, 'ShiftSwapAutoReject', 'ShiftSwap', swap.ID, null, { reason: restMsg }, 'Rest-period violation for target employee');
                    await tx2.commit();
                } catch (e) {
                    await tx2.rollback(e);
                }
                return req.error(422, restMsg);
            }

            await tx.run(UPDATE('wfms.ShiftSwapRequests').set({ status: 'PendingPeer', eligibilityNotes: 'Eligible - skills and availability matched.' }).where({ ID: swap.ID }));
            await writeApprovalHistory(tx, 'ShiftSwap', swap.ID, userId(req), 'Submitted', 'PendingPeer', 'Swap submitted, awaiting peer decision');
            await writeAudit(tx, req, 'ShiftSwapSubmit', 'ShiftSwap', swap.ID, null, { status: 'PendingPeer' }, 'Shift swap submitted');
            return {};
        });

        /* ---------------- peer accept / reject ---------------- */
        srv.on('peerAcceptSwap', async (req) => {
            const tx = cds.tx(req);
            const swap = await tx.run(SELECT.one.from('wfms.ShiftSwapRequests').where({ ID: req.data.ID }));
            if (!swap) return req.error(404, 'Swap not found');
            if (swap.status !== 'PendingPeer') return req.error(409, `Swap is not pending peer decision (status: ${swap.status})`);
            await tx.run(UPDATE('wfms.ShiftSwapRequests').set({
                status: 'PendingManager', peerDecision: 'Accepted', peerDecisionAt: new Date().toISOString(), peerComments: req.data.comments || ''
            }).where({ ID: swap.ID }));
            await writeApprovalHistory(tx, 'ShiftSwap', swap.ID, userId(req), 'PeerAccepted', 'PendingManager', req.data.comments);
            await writeAudit(tx, req, 'ShiftSwapPeerAccept', 'ShiftSwap', swap.ID, { status: 'PendingPeer' }, { status: 'PendingManager' }, req.data.comments);
            return {};
        });

        srv.on('peerRejectSwap', async (req) => {
            const tx = cds.tx(req);
            const swap = await tx.run(SELECT.one.from('wfms.ShiftSwapRequests').where({ ID: req.data.ID }));
            if (!swap) return req.error(404, 'Swap not found');
            if (swap.status !== 'PendingPeer') return req.error(409, `Swap is not pending peer decision`);
            await tx.run(UPDATE('wfms.ShiftSwapRequests').set({
                status: 'Rejected', peerDecision: 'Rejected', peerDecisionAt: new Date().toISOString(), peerComments: req.data.comments || ''
            }).where({ ID: swap.ID }));
            await writeApprovalHistory(tx, 'ShiftSwap', swap.ID, userId(req), 'PeerRejected', 'Rejected', req.data.comments);
            await writeAudit(tx, req, 'ShiftSwapPeerReject', 'ShiftSwap', swap.ID, { status: 'PendingPeer' }, { status: 'Rejected' }, req.data.comments);
            return {};
        });

        /* ---------------- manager approve / reject ---------------- */
        srv.on('approveShiftSwap', async (req) => {
            const tx = cds.tx(req);
            const swap = await tx.run(SELECT.one.from('wfms.ShiftSwapRequests').where({ ID: req.data.ID }));
            if (!swap) return req.error(404, 'Swap not found');
            if (swap.status !== 'PendingManager') return req.error(409, `Swap is not pending manager approval`);

            const rs = await tx.run(SELECT.one.from('wfms.ShiftAssignments').where({ ID: swap.requestorShift_ID }));
            const ts = swap.targetShift_ID ? await tx.run(SELECT.one.from('wfms.ShiftAssignments').where({ ID: swap.targetShift_ID })) : null;

            // perform the swap inside the transaction:
            //   - requestor shift reassigned to target employee
            //   - target shift (if any) reassigned to requestor
            if (ts) {
                await tx.run(UPDATE('wfms.ShiftAssignments').set({ employee_ID: swap.requestor_ID, swapRequest_ID: swap.ID }).where({ ID: ts.ID }));
                await tx.run(UPDATE('wfms.ShiftAssignments').set({ employee_ID: swap.targetEmployee_ID, swapRequest_ID: swap.ID }).where({ ID: rs.ID }));
            } else {
                // no target shift: simply move the requestor shift to the target
                await tx.run(UPDATE('wfms.ShiftAssignments').set({ employee_ID: swap.targetEmployee_ID, swapRequest_ID: swap.ID }).where({ ID: rs.ID }));
            }

            await tx.run(UPDATE('wfms.ShiftSwapRequests').set({
                status: 'Approved', managerDecision: 'Approved', managerDecisionAt: new Date().toISOString(), managerComments: req.data.comments || ''
            }).where({ ID: swap.ID }));
            await writeApprovalHistory(tx, 'ShiftSwap', swap.ID, userId(req), 'Approved', 'Approved', req.data.comments);
            await writeAudit(tx, req, 'ShiftSwapApprove', 'ShiftSwap', swap.ID,
                { requestorShift: rs.employee_ID, targetShift: ts ? ts.employee_ID : null },
                { requestorShift: swap.targetEmployee_ID, targetShift: swap.requestor_ID }, req.data.comments);
            return {};
        });

        srv.on('rejectShiftSwap', async (req) => {
            const tx = cds.tx(req);
            const swap = await tx.run(SELECT.one.from('wfms.ShiftSwapRequests').where({ ID: req.data.ID }));
            if (!swap) return req.error(404, 'Swap not found');
            if (!['PendingManager', 'PendingPeer'].includes(swap.status)) return req.error(409, `Cannot reject a swap in status ${swap.status}`);
            await tx.run(UPDATE('wfms.ShiftSwapRequests').set({
                status: 'Rejected', managerDecision: 'Rejected', managerDecisionAt: new Date().toISOString(), managerComments: req.data.comments || ''
            }).where({ ID: swap.ID }));
            await writeApprovalHistory(tx, 'ShiftSwap', swap.ID, userId(req), 'Rejected', 'Rejected', req.data.comments);
            await writeAudit(tx, req, 'ShiftSwapReject', 'ShiftSwap', swap.ID, { status: swap.status }, { status: 'Rejected' }, req.data.comments);
            return {};
        });

        /* ---------------- exposed rest-period function ---------------- */
        srv.on('validateRestPeriod', async (req) => {
            const tx = cds.tx(req);
            const { employee_ID, date, startTime, endTime } = req.data;
            return await calc.validateRestPeriod(tx, employee_ID, date, startTime, endTime);
        });
};
