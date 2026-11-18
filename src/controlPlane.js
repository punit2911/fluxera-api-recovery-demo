import { newId, sleep } from './runtime.js';
import { sign } from './signing.js';
import { analyzeContinuity, decide, diagnose } from './analysis.js';

const FINAL = new Set(['verified', 'recovery_failed', 'escalated', 'recovery_not_observed']);

// Detects failed executions, diagnoses them, decides on a recovery action,
// dispatches the configured recovery webhook and verifies the outcome.
// It never touches an in-flight customer request: it only reports, dispatches
// and observes.
export function createControlPlane({ store, sandbox, getWebhookUrl, secret, recoveryTimeoutMs = 60000 }) {
  const log = (incident, event, detail) => {
    incident.timeline.push({ at: Date.now(), event, detail });
    store.touch();
  };

  async function openIncident(execution) {
    const incident = {
      id: `inc_${String(++store.incidentSeq).padStart(3, '0')}`,
      executionId: execution.id,
      runId: execution.runId,
      scenario: execution.scenario,
      autoRecover: execution.options?.autoRecover !== false,
      status: 'detected',
      detectedAt: Date.now(),
      diagnosis: null,
      continuity: null,
      decision: null,
      actions: [],
      recoveryExecutionId: null,
      verification: null,
      escalation: null,
      timeline: [],
    };
    store.incidents.set(incident.id, incident);
    log(incident, 'detected', `Execution ${execution.id} ended failed`);

    await sleep(900);
    const nodes = store.nodesOf(execution.id);
    incident.diagnosis = diagnose(execution, nodes);
    incident.status = 'diagnosed';
    log(
      incident,
      'diagnosed',
      `${incident.diagnosis.component.integrationName}: ${incident.diagnosis.error.category} on step ${incident.diagnosis.stepId}`,
    );

    await sleep(900);
    incident.continuity = analyzeContinuity(
      execution,
      nodes,
      store.checkpoints.get(execution.id) ?? [],
      incident.diagnosis,
    );
    log(incident, 'continuity', incident.continuity.summary);

    await sleep(800);
    incident.decision = decide(execution, incident.diagnosis, incident.continuity, {
      webhookConfigured: Boolean(getWebhookUrl()),
    });
    log(incident, 'decision', `${incident.decision.action}: ${incident.decision.rationale}`);

    if (incident.decision.action === 'escalate') {
      escalate(incident, incident.decision.rationale);
      return incident;
    }
    if (incident.autoRecover) {
      await sleep(900);
      await dispatch(incident.id);
    } else {
      incident.status = 'awaiting_approval';
      log(incident, 'awaiting_approval', 'Waiting for a person to approve the recovery action');
    }
    return incident;
  }

  function escalate(incident, reason) {
    incident.escalation = {
      id: `ESC-${String(incident.id).slice(-3)}`,
      owner: 'on-call engineer (sandbox queue)',
      reason,
      createdAt: Date.now(),
    };
    incident.actions.push({
      id: newId('act'),
      type: 'escalate',
      dispatchedAt: Date.now(),
      outcome: 'escalated',
      webhook: null,
    });
    incident.status = 'escalated';
    log(incident, 'escalated', `Recovery is not safe to automate. Escalated as ${incident.escalation.id}`);
  }

  async function dispatch(incidentId) {
    const incident = store.incidents.get(incidentId);
    if (!incident) return { ok: false, reason: 'not_found' };
    if (!['diagnosed', 'awaiting_approval'].includes(incident.status)) {
      return { ok: false, reason: `incident is ${incident.status}` };
    }
    if (!incident.decision || incident.decision.action === 'escalate') {
      return { ok: false, reason: 'no recovery action to dispatch' };
    }

    const execution = store.executions.get(incident.executionId);
    const recoveryId = newId('rec');
    const payload = {
      recoveryId,
      incidentId: incident.id,
      executionId: execution.id,
      runId: execution.runId,
      scenario: execution.scenario,
      workflow: execution.workflowName,
      failedStepId: incident.decision.failedStepId,
      action: {
        type: incident.decision.action,
        checkpointId: incident.decision.checkpointId ?? null,
        fallbackIntegration: incident.decision.fallbackIntegration ?? null,
      },
      issuedAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = sign(secret, timestamp, body);
    const url = getWebhookUrl();

    const action = {
      id: newId('act'),
      type: incident.decision.action,
      recoveryId,
      dispatchedAt: Date.now(),
      outcome: 'pending',
      payload,
      webhook: { url, status: null, response: null, error: null, signaturePreview: `${signature.slice(0, 22)}…` },
    };
    incident.actions.push(action);
    incident.status = 'dispatching';
    log(incident, 'dispatched', `Recovery webhook dispatched (${action.type}, ${recoveryId})`);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fluxera-timestamp': timestamp,
          'x-fluxera-signature': signature,
          'x-fluxera-recovery-id': recoveryId,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      action.webhook.status = res.status;
      action.webhook.response = await res.json().catch(() => null);
    } catch (err) {
      action.webhook.error = err.message;
    }

    const accepted = action.webhook.status !== null && action.webhook.status >= 200 && action.webhook.status < 300;
    if (!accepted) {
      action.outcome = 'rejected';
      escalate(incident, `Recovery webhook was not accepted (${action.webhook.status ?? action.webhook.error})`);
      return { ok: false, reason: 'webhook_rejected' };
    }
    action.outcome = 'accepted';
    if (incident.status === 'dispatching') incident.status = 'recovering';
    log(incident, 'accepted', `Integration accepted the recovery request (HTTP ${action.webhook.status})`);

    const timer = setTimeout(() => {
      if (!FINAL.has(incident.status)) {
        incident.status = 'recovery_not_observed';
        log(incident, 'recovery_not_observed', 'No successful linked recovery execution was observed in time');
      }
    }, recoveryTimeoutMs);
    timer.unref?.();
    return { ok: true, recoveryId };
  }

  function onCreated(execution) {
    if (execution.kind !== 'recovery' || !execution.recoveryOf) return;
    const incident = [...store.incidents.values()].find((i) => i.executionId === execution.recoveryOf);
    if (!incident || FINAL.has(incident.status)) return;
    incident.recoveryExecutionId = execution.id;
    incident.status = 'recovering';
    log(incident, 'recovery_started', `Linked recovery execution ${execution.id} started`);
  }

  function verifyRecovery(incident, original, recovery) {
    const recNodes = store.nodesOf(recovery.id);
    const failedStepId = incident.decision.failedStepId;
    const leafOk = recNodes.some(
      (n) => n.type === 'api' && n.status === 'success' && stepOf(recNodes, n)?.stepId === failedStepId,
    );
    const executedSteps = recNodes
      .filter((n) => n.type === 'step' && n.status !== 'skipped')
      .map((n) => n.stepId);
    const completedBefore = new Set(incident.continuity.buckets.completed);
    const replayed = executedSteps.filter((id) => completedBefore.has(id));
    const ledger = sandbox.ledger(recovery.runId);

    const checks = [
      {
        id: 'linked',
        label: 'Recovery execution is linked to the original',
        pass: recovery.recoveryOf === original.id,
        detail: `${recovery.id} recoveryOf ${original.id}`,
      },
      {
        id: 'status',
        label: 'Recovery execution finished successfully',
        pass: recovery.status === 'success',
        detail: `Status ${recovery.status}`,
      },
      {
        id: 'leaf',
        label: 'The previously failed step now has a successful API result',
        pass: leafOk,
        detail: leafOk ? `Step ${failedStepId} succeeded on the recovery run` : `Step ${failedStepId} has no successful leaf`,
      },
      {
        id: 'no-replay',
        label: 'No completed work was replayed',
        pass: replayed.length === 0,
        detail: replayed.length ? `Re-executed: ${replayed.join(', ')}` : 'All earlier steps were restored from the checkpoint',
      },
      {
        id: 'no-duplicates',
        label: 'No duplicate side effects in the sandbox ledger',
        pass: ledger.duplicateSideEffects === 0,
        detail: `${ledger.duplicateSideEffects} duplicates, ${ledger.crmCases.length} CRM case, ${ledger.liveOperations} live operations`,
      },
    ];
    return { checks, verified: checks.every((c) => c.pass), verifiedAt: Date.now() };
  }

  function onEnded(execution) {
    if (execution.kind === 'recovery') {
      const incident = [...store.incidents.values()].find((i) => i.executionId === execution.recoveryOf);
      if (!incident || FINAL.has(incident.status)) return;
      incident.recoveryExecutionId = execution.id;
      const original = store.executions.get(execution.recoveryOf);
      const verification = verifyRecovery(incident, original, execution);
      incident.verification = verification;
      if (verification.verified) {
        incident.status = 'verified';
        const action = incident.actions[incident.actions.length - 1];
        if (action) action.outcome = 'verified';
        log(incident, 'verified', `Recovery verified by ${execution.id}`);
      } else {
        incident.status = 'recovery_failed';
        const action = incident.actions[incident.actions.length - 1];
        if (action) action.outcome = 'failed';
        log(incident, 'recovery_failed', `Recovery execution ${execution.id} ended ${execution.status}. Not verified`);
      }
      return;
    }
    if (execution.kind === 'original' && execution.status === 'failed') {
      openIncident(execution).catch((err) => {
        // Never let a diagnosis error take the process down.
        console.error('incident handling failed:', err);
      });
    }
  }

  store.on('execution:created', onCreated);
  store.on('execution:ended', onEnded);

  return {
    dispatch,
    isBusy() {
      if ([...store.executions.values()].some((e) => e.status === 'running')) return true;
      return [...store.incidents.values()].some((i) => !FINAL.has(i.status));
    },
    // Safe to wipe state only when nothing asynchronous is still writing to it.
    canReset() {
      if ([...store.executions.values()].some((e) => e.status === 'running')) return false;
      const inFlight = new Set(['detected', 'diagnosed', 'dispatching', 'recovering']);
      return ![...store.incidents.values()].some((i) => inFlight.has(i.status));
    },
    detach() {
      store.off('execution:created', onCreated);
      store.off('execution:ended', onEnded);
    },
  };
}

function stepOf(nodes, node) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  let cur = node;
  while (cur) {
    if (cur.type === 'step') return cur;
    cur = cur.parentId ? map.get(cur.parentId) : null;
  }
  return null;
}
