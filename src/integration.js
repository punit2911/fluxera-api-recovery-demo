import { callApi } from './apiClient.js';
import { byId } from './integrations.js';
import { verify } from './signing.js';

export const WORKFLOW_NAME = 'support.refund_inquiry_resolution';
export const SCENARIOS = {
  resume: 'Temporary failure, resume from checkpoint',
  fallback: 'Provider outage, approved fallback',
  escalate: 'Unsafe failure, escalate (no replay)',
};

const CUSTOMER = { id: 'cus_2041', name: 'Priya', orderId: 'ord_58213', accountId: 'acct_2041' };

// The dependency graph is declared by the integration as workflow metadata.
// Fluxera uses it to work out what is waiting and what can safely continue.
export function buildPlan(scenario) {
  const common = [
    {
      id: 's1', op: 'memory.retrieve', label: 'Retrieve customer context', dependsOn: [],
      integration: 'customer-memory', category: 'memory', produces: 'Customer context loaded',
      sideEffect: false, idempotent: true,
    },
    {
      id: 's2', op: 'orders.lookup', label: 'Look up order', dependsOn: [],
      integration: 'orders-db', category: 'database', produces: 'Order record loaded',
      sideEffect: false, idempotent: true,
    },
    {
      id: 's3', op: 'accounts.check', label: 'Check account standing', dependsOn: [],
      integration: 'accounts-service', category: 'internal', produces: 'Account standing confirmed',
      sideEffect: false, idempotent: true,
    },
    {
      id: 's4', op: 'model.draft', label: 'Draft reply', dependsOn: ['s1', 's2', 's3'],
      integration: 'model-gateway', category: 'ai', produces: 'Reply drafted',
      sideEffect: false, idempotent: true,
    },
    {
      id: 's5', op: 'crm.open_case', label: 'Open CRM case', dependsOn: ['s2', 's4'],
      integration: 'crm-sandbox', category: 'third_party', produces: 'CRM case opened',
      sideEffect: true, idempotent: true,
    },
  ];

  if (scenario === 'escalate') {
    return [
      ...common,
      {
        id: 's6', op: 'payments.refund', label: 'Issue refund', dependsOn: ['s4', 's5'],
        integration: 'payments-sandbox', category: 'third_party', produces: 'Refund issued',
        sideEffect: true, idempotent: false, irreversible: true,
      },
      {
        id: 's7', op: 'notify.send', label: 'Notify customer', dependsOn: ['s4', 's6'],
        integration: 'notify-gateway', category: 'tool', produces: 'Customer notified',
        sideEffect: true, idempotent: true,
      },
      {
        id: 's8', op: 'audit.write', label: 'Write audit log', dependsOn: ['s5'],
        integration: 'orders-db', category: 'database', produces: 'Audit entry written',
        sideEffect: true, idempotent: true,
      },
    ];
  }

  return [
    ...common,
    {
      id: 's6', op: 'notify.send', label: 'Notify customer', dependsOn: ['s4', 's5'],
      integration: 'notify-gateway', category: 'tool', produces: 'Customer notified',
      sideEffect: true, idempotent: true,
    },
    {
      id: 's7', op: 'analytics.record', label: 'Record analytics event', dependsOn: ['s6'],
      integration: 'analytics-saas', category: 'third_party', produces: 'Analytics event recorded',
      sideEffect: true, idempotent: true,
    },
    {
      id: 's8', op: 'audit.write', label: 'Write audit log', dependsOn: ['s5'],
      integration: 'orders-db', category: 'database', produces: 'Audit entry written',
      sideEffect: true, idempotent: true,
    },
  ];
}

// The "customer integration": it owns the workflow, its checkpoints and the
// recovery webhook. Fluxera only dispatches and observes.
export function createIntegration({ store, tracer, sandbox, getOrigin, config }) {
  const seenRecoveries = new Map();

  const apiSpec = (integrationId, name, extra = {}) => {
    const i = byId(integrationId);
    return {
      integration: i.id,
      category: i.category,
      apiType: i.type,
      mode: i.mode,
      name,
      ...extra,
    };
  };

  const idem = (runId, step) => `${runId}:${step.id}`;

  const handlers = {
    'memory.retrieve': ({ step }) =>
      tracer.memory('customer-memory', {}, async () => {
        const res = await tracer.track(
          apiSpec(step.integration, 'GET /v1/customers/{id}/context', { maxAttempts: 2, backoffMs: 300 }),
          () => callApi(getOrigin(), { path: `/stub/memory/v1/customers/${CUSTOMER.id}/context` }),
        );
        return { context: res.data };
      }),

    'orders.lookup': ({ step }) =>
      tracer
        .track(apiSpec(step.integration, 'GET /v1/orders/{id}', { maxAttempts: 2, backoffMs: 300 }), () =>
          callApi(getOrigin(), { path: `/stub/db/v1/orders/${CUSTOMER.orderId}` }),
        )
        .then((res) => ({ order: res.data })),

    'accounts.check': ({ step }) =>
      tracer
        .track(apiSpec(step.integration, 'GET /v1/accounts/{id}', { maxAttempts: 2, backoffMs: 300 }), () =>
          callApi(getOrigin(), { path: `/stub/internal/v1/accounts/${CUSTOMER.accountId}` }),
        )
        .then((res) => ({ account: res.data })),

    'model.draft': ({ step, state }) =>
      tracer
        .track(apiSpec(step.integration, 'POST /v1/complete', { maxAttempts: 1 }), () =>
          callApi(getOrigin(), {
            method: 'POST',
            path: '/stub/ai/v1/complete',
            body: {
              input: {
                customerName: CUSTOMER.name,
                orderId: CUSTOMER.orderId,
                tier: state.account?.tier,
                history: state.context?.recentTickets,
              },
            },
          }),
        )
        .then((res) => ({ draft: res.data.text, usage: res.data.usage })),

    'crm.open_case': ({ step, runId }) =>
      tracer.tool('crm.create_case', {}, async () => {
        const res = await tracer.track(
          apiSpec(step.integration, 'POST /v1/cases', {
            maxAttempts: 2,
            backoffMs: 300,
            idempotencyKey: idem(runId, step),
          }),
          () =>
            callApi(getOrigin(), {
              method: 'POST',
              path: '/stub/crm/v1/cases',
              headers: { 'idempotency-key': idem(runId, step) },
              body: { subject: `Delayed order ${CUSTOMER.orderId}` },
            }),
        );
        return { caseId: res.data.caseId };
      }),

    'notify.send': ({ step, runId, state, action }) => {
      const useFallback = action?.type === 'fallback' && action.fallbackIntegration;
      const integrationId = useFallback ? action.fallbackIntegration : step.integration;
      const toolName = useFallback ? 'email.send' : 'notify.send';
      const path = useFallback ? '/stub/email/v1/messages' : '/stub/notify/v1/messages';
      return tracer.tool(toolName, useFallback ? { fallbackFor: step.integration } : {}, async () => {
        const res = await tracer.track(
          apiSpec(integrationId, 'POST /v1/messages', {
            maxAttempts: 1,
            backoffMs: 700,
            idempotencyKey: idem(runId, step),
          }),
          () =>
            callApi(getOrigin(), {
              method: 'POST',
              path,
              headers: { 'idempotency-key': idem(runId, step) },
              body: { template: 'delay_refund', preview: state.draft?.slice(0, 80) },
            }),
        );
        return { notificationId: res.data.id, notifiedVia: integrationId };
      });
    },

    'payments.refund': ({ step, runId }) =>
      tracer.tool('payments.refund', {}, async () => {
        // Non-idempotent operation: a single attempt, never retried automatically.
        const res = await tracer.track(
          apiSpec(step.integration, 'POST /v1/refunds', { maxAttempts: 1 }),
          () =>
            callApi(getOrigin(), {
              method: 'POST',
              path: '/stub/payments/v1/refunds',
              headers: { 'idempotency-key': idem(runId, step) },
              body: { orderId: CUSTOMER.orderId, amount: 84.5, currency: 'USD' },
            }),
        );
        return { refundId: res.data.refundId };
      }),

    'analytics.record': ({ step, runId }) =>
      tracer
        .track(
          apiSpec(step.integration, 'POST /v1/events', {
            maxAttempts: 2,
            backoffMs: 300,
            idempotencyKey: idem(runId, step),
          }),
          () =>
            callApi(getOrigin(), {
              method: 'POST',
              path: '/stub/analytics/v1/events',
              headers: { 'idempotency-key': idem(runId, step) },
              body: { event: 'ticket_resolved', orderId: CUSTOMER.orderId },
            }),
        )
        .then(() => ({ analyticsRecorded: true })),

    'audit.write': ({ step, runId }) =>
      tracer
        .track(
          apiSpec(step.integration, 'POST /v1/audit', {
            maxAttempts: 2,
            backoffMs: 300,
            idempotencyKey: idem(runId, step),
          }),
          () =>
            callApi(getOrigin(), {
              method: 'POST',
              path: '/stub/db/v1/audit',
              headers: { 'idempotency-key': idem(runId, step) },
              body: { actor: 'support-agent', orderId: CUSTOMER.orderId },
            }),
        )
        .then((res) => ({ auditId: res.data.auditId })),
  };

  async function execute({ runId, scenario, kind = 'original', recoveryOf = null, resume = null, action = null, options = {} }) {
    const plan = buildPlan(scenario);
    return tracer.workflow(
      WORKFLOW_NAME,
      {
        runId,
        scenario,
        kind,
        recoveryOf,
        plan,
        action,
        options,
        resumedFrom: resume ? { executionId: resume.executionId, checkpointId: resume.checkpoint.id } : null,
      },
      async () => {
        await tracer.agent('support-agent', {}, async () => {
          let state = resume ? structuredClone(resume.checkpoint.state) : {};
          const restoredIds = new Set();
          if (resume) {
            const idx = plan.findIndex((s) => s.id === resume.checkpoint.afterStep);
            plan.slice(0, idx + 1).forEach((s) => restoredIds.add(s.id));
          }
          const originalNodes = resume ? store.nodesOf(resume.executionId) : [];

          for (const step of plan) {
            if (restoredIds.has(step.id)) {
              const original = originalNodes.find((n) => n.type === 'step' && n.stepId === step.id);
              const leafCost = originalNodes
                .filter((n) => n.type === 'api')
                .filter((n) => ancestorStepId(originalNodes, n) === step.id)
                .reduce((acc, n) => acc + n.cost, 0);
              tracer.restored(step.label, {
                stepId: step.id,
                checkpointId: resume.checkpoint.id,
                originalNodeId: original?.id,
                originalCost: leafCost,
                originalDurationMs: original?.durationMs ?? 0,
                integration: step.integration,
              });
              continue;
            }
            const patch = await tracer.step(
              step.label,
              {
                stepId: step.id,
                op: step.op,
                integration: step.integration,
                sideEffect: step.sideEffect,
                idempotent: step.idempotent,
              },
              () => handlers[step.op]({ step, state, runId, action }),
            );
            Object.assign(state, patch);
            if (step.id !== plan[plan.length - 1].id) {
              tracer.checkpoint(`cp_${step.id}`, state, { afterStep: step.id });
            }
          }
        });
      },
    );
  }

  function startRun({ runId, scenario, options = {} }) {
    sandbox.configureForScenario(scenario);
    return execute({ runId, scenario, options });
  }

  // Recovery webhook owned by the integration. Verifies the signature,
  // de-duplicates deliveries and only then starts the linked recovery run.
  async function handleWebhook({ headers, rawBody }) {
    const ok = verify(config.webhookSecret, headers['x-fluxera-timestamp'], rawBody, headers['x-fluxera-signature']);
    if (!ok) return { status: 401, body: { accepted: false, reason: 'invalid_signature' } };

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { accepted: false, reason: 'invalid_json' } };
    }

    if (seenRecoveries.has(payload.recoveryId)) {
      return { status: 200, body: { accepted: true, duplicate: true, recoveryId: payload.recoveryId } };
    }

    const { executionId, action } = payload;
    const original = store.executions.get(executionId);
    if (!original) return { status: 404, body: { accepted: false, reason: 'execution_not_found' } };

    let checkpoint = null;
    if (action.type !== 'retry') {
      checkpoint = store.getCheckpoint(executionId, action.checkpointId);
      if (!checkpoint) return { status: 409, body: { accepted: false, reason: 'checkpoint_not_found' } };
    }

    seenRecoveries.set(payload.recoveryId, Date.now());
    setImmediate(() => {
      execute({
        runId: payload.runId,
        scenario: payload.scenario,
        kind: 'recovery',
        recoveryOf: executionId,
        resume: checkpoint ? { executionId, checkpoint } : null,
        action,
        options: original.options,
      }).catch(() => {});
    });
    return { status: 202, body: { accepted: true, recoveryId: payload.recoveryId } };
  }

  return { startRun, handleWebhook, execute, resetSeen: () => seenRecoveries.clear() };
}

function ancestorStepId(nodes, node) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = node;
  while (cur) {
    if (cur.type === 'step') return cur.stepId;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return null;
}
