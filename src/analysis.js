import { byId, FALLBACKS } from './integrations.js';

// Failure categories Fluxera knows how to reason about.
export const CATEGORIES = {
  TEMPORARY_UNAVAILABLE: {
    label: 'Temporary unavailability',
    retryable: true,
    cause: 'The upstream answered 503 and signalled a short-lived condition.',
  },
  PROVIDER_OUTAGE: {
    label: 'Provider outage',
    retryable: true,
    cause: 'The provider reports a sustained outage with a long Retry-After. Retrying the same provider will keep failing.',
  },
  RATE_LIMITED: {
    label: 'Rate limited',
    retryable: true,
    cause: 'The upstream rejected the call because a quota was exceeded.',
  },
  TIMEOUT: {
    label: 'Timeout',
    retryable: true,
    cause: 'The upstream did not answer in time.',
  },
  NETWORK_ERROR: {
    label: 'Network error',
    retryable: true,
    cause: 'The connection to the upstream failed before a response arrived.',
  },
  AMBIGUOUS_OUTCOME: {
    label: 'Ambiguous outcome',
    retryable: false,
    cause: 'The request may have been accepted upstream but the result is unknown. Replaying could duplicate an irreversible action.',
  },
  AUTH_FAILED: {
    label: 'Authentication failed',
    retryable: false,
    cause: 'Credentials were rejected. A retry cannot succeed without a configuration change.',
  },
  BAD_REQUEST: {
    label: 'Bad request',
    retryable: false,
    cause: 'The upstream rejected the request itself. A retry would fail the same way.',
  },
  UPSTREAM_ERROR: {
    label: 'Upstream error',
    retryable: false,
    cause: 'The upstream returned an unclassified server error.',
  },
  UNKNOWN: { label: 'Unknown', retryable: false, cause: 'The failure could not be classified.' },
};

const infoFor = (category) => CATEGORIES[category] ?? CATEGORIES.UNKNOWN;

function ancestorOfType(nodes, node, type) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  let cur = node;
  while (cur) {
    if (cur.type === type) return cur;
    cur = cur.parentId ? map.get(cur.parentId) : null;
  }
  return null;
}

export function ancestorStep(nodes, node) {
  return ancestorOfType(nodes, node, 'step');
}

export function diagnose(execution, nodes) {
  const leaf = nodes.find((n) => n.type === 'api' && n.status === 'error');
  if (!leaf) return null;
  const step = ancestorStep(nodes, leaf);
  const tool = ancestorOfType(nodes, leaf, 'tool');
  const planStep = execution.plan.find((s) => s.id === step?.stepId);
  const integration = byId(leaf.integration);
  const info = infoFor(leaf.errorCategory);
  const failedAttempts = leaf.attempts.filter((a) => a.status === 'error');
  const lastAttempt = leaf.attempts[leaf.attempts.length - 1];
  const waiting = execution.plan.filter((s) => s.id !== planStep?.id && dependsTransitively(execution.plan, s, planStep?.id));

  return {
    failedNodeId: leaf.id,
    stepId: planStep?.id ?? null,
    stepLabel: planStep?.label ?? step?.name ?? 'unknown step',
    component: {
      name: leaf.name,
      toolName: tool?.name ?? null,
      integration: leaf.integration,
      integrationName: integration?.name ?? leaf.integration,
      apiType: leaf.apiType,
      apiCategory: leaf.apiCategory,
      mode: leaf.mode,
      idempotencyKey: leaf.idempotencyKey,
    },
    error: {
      category: leaf.errorCategory,
      categoryLabel: info.label,
      httpStatus: lastAttempt?.httpStatus ?? null,
      message: leaf.errorMessage,
      retryable: info.retryable,
    },
    attempts: leaf.attempts.map((a) => ({ ...a })),
    attemptCount: leaf.attempts.length,
    latencyMs: leaf.durationMs,
    cost: {
      failedCalls: failedAttempts.reduce((s, a) => s + a.cost, 0),
      retryWaste: failedAttempts.filter((a) => a.n > 1).reduce((s, a) => s + a.cost, 0),
    },
    cause: info.cause,
    impact:
      waiting.length > 0
        ? `${waiting.length} dependent step${waiting.length === 1 ? ' is' : 's are'} blocked: ${waiting
            .map((s) => s.label)
            .join(', ')}.`
        : 'No downstream steps depend on the failed operation.',
    guidance: guidanceFor(leaf.errorCategory, planStep),
    evidence: [
      `${leaf.attempts.length} attempt${leaf.attempts.length === 1 ? '' : 's'} recorded on ${leaf.name}`,
      `HTTP ${lastAttempt?.httpStatus ?? 'n/a'} with category ${leaf.errorCategory}`,
      `Execution ${execution.id} ended ${execution.status}`,
    ],
  };
}

function guidanceFor(category, planStep) {
  switch (category) {
    case 'TEMPORARY_UNAVAILABLE':
      return 'Resume from the last checkpoint. The failed call carries an idempotency key, so it is safe to replay while completed work stays untouched.';
    case 'PROVIDER_OUTAGE':
      return 'Do not keep retrying the same provider. Resume from the last checkpoint using the approved fallback channel.';
    case 'AMBIGUOUS_OUTCOME':
      return `Do not replay${planStep ? ` "${planStep.label}"` : ''}. The outcome is unknown and the operation is not idempotent, so a person should reconcile it first.`;
    default:
      return 'Review the failure and recover manually unless a safe, approved recovery path exists.';
  }
}

function dependsTransitively(plan, step, targetId) {
  if (!targetId) return false;
  const seen = new Set();
  const walk = (s) => {
    for (const d of s.dependsOn) {
      if (d === targetId) return true;
      if (seen.has(d)) continue;
      seen.add(d);
      const next = plan.find((p) => p.id === d);
      if (next && walk(next)) return true;
    }
    return false;
  };
  return walk(step);
}

// Work continuity: the state of the whole execution, not only the failed call.
export function analyzeContinuity(execution, nodes, checkpoints, diagnosis) {
  const plan = execution.plan;
  const stepNodes = nodes.filter((n) => n.type === 'step');
  const stateOf = new Map();
  const steps = [];

  const costOfStep = (stepNode) =>
    nodes
      .filter((n) => n.type === 'api' && ancestorStep(nodes, n)?.id === stepNode?.id)
      .reduce((s, n) => s + n.cost, 0);

  for (const step of plan) {
    const node = stepNodes.find((n) => n.stepId === step.id);
    let state;
    let blockedBy = [];
    if (node?.status === 'success') state = 'completed';
    else if (node?.status === 'error') state = 'failed';
    else {
      blockedBy = step.dependsOn.filter((d) => ['failed', 'waiting'].includes(stateOf.get(d)));
      if (blockedBy.length) state = 'waiting';
      else if (step.sideEffect && !step.idempotent) state = 'needs_review';
      else state = 'safe_to_continue';
    }
    stateOf.set(step.id, state);
    steps.push({
      id: step.id,
      label: step.label,
      state,
      integration: step.integration,
      category: step.category,
      dependsOn: step.dependsOn,
      blockedBy,
      sideEffect: step.sideEffect,
      idempotent: step.idempotent,
      irreversible: Boolean(step.irreversible),
      produces: step.produces,
      cost: node ? costOfStep(node) : 0,
      durationMs: node?.durationMs ?? null,
    });
  }

  const ids = (state) => steps.filter((s) => s.state === state).map((s) => s.id);
  const failed = steps.filter((s) => s.state === 'failed');
  const unresolved = steps
    .filter((s) => s.state === 'failed' || s.state === 'waiting')
    .map((s) => ({
      stepId: s.id,
      outcome: s.produces,
      reason:
        s.state === 'failed'
          ? diagnosis?.error.category === 'AMBIGUOUS_OUTCOME'
            ? 'Failed with an unknown outcome. Needs reconciliation.'
            : 'Failed and not yet recovered.'
          : `Blocked by ${s.blockedBy.join(', ')}.`,
    }));

  const cp = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
  const failedStep = failed[0];
  const canRetry = Boolean(failedStep && failedStep.idempotent && diagnosis?.error.retryable);
  const canResume = Boolean(cp && canRetry);
  const protectedWork = steps.filter((s) => s.state === 'completed' && s.sideEffect).map((s) => s.id);

  return {
    steps,
    buckets: {
      completed: ids('completed'),
      failed: ids('failed'),
      waiting: ids('waiting'),
      safeToContinue: ids('safe_to_continue'),
      needsReview: ids('needs_review'),
      unresolved,
    },
    affected: ids('waiting'),
    checkpoint: cp ? { id: cp.id, afterStep: cp.afterStep, savedAt: cp.savedAt } : null,
    canRetry,
    canResume,
    doNotReplay: protectedWork,
    summary: continuitySummary(steps, cp, canResume),
  };
}

function continuitySummary(steps, cp, canResume) {
  const n = (state) => steps.filter((s) => s.state === state).length;
  const parts = [
    `${n('completed')} completed`,
    `${n('failed')} failed`,
    `${n('waiting')} waiting`,
    `${n('safe_to_continue')} safe to continue`,
  ];
  const tail = cp
    ? canResume
      ? `Eligible recovery point: ${cp.id} (after ${cp.afterStep}).`
      : `Latest checkpoint ${cp.id} exists but the failed step is not eligible for automatic recovery.`
    : 'No checkpoint recorded.';
  return `${parts.join(', ')}. ${tail}`;
}

// Recovery policy: decides whether recovery is safe and supported.
export function decide(execution, diagnosis, continuity, { webhookConfigured = true } = {}) {
  const step = continuity.steps.find((s) => s.id === diagnosis.stepId);
  const info = infoFor(diagnosis.error.category);
  const fallbackId = FALLBACKS[diagnosis.component.integration] ?? null;
  const cp = continuity.checkpoint;

  const checks = [
    {
      id: 'category',
      label: 'Failure category is transient and recoverable',
      pass: info.retryable,
      detail: `${diagnosis.error.category}${info.retryable ? '' : ' is not recoverable by replay'}`,
    },
    {
      id: 'idempotent',
      label: 'Failed operation supports an idempotency key',
      pass: Boolean(step?.idempotent),
      detail: step?.idempotent
        ? `Key ${diagnosis.component.idempotencyKey ?? 'present'}`
        : 'No idempotency support: a replay could duplicate or repeat an irreversible action',
    },
    {
      id: 'checkpoint',
      label: 'Eligible checkpoint exists',
      pass: Boolean(cp),
      detail: cp ? `${cp.id} saved after ${cp.afterStep}` : 'No checkpoint recorded',
    },
    {
      id: 'no-replay',
      label: 'Completed side-effect work will not be replayed',
      pass: Boolean(cp),
      detail: cp
        ? `Steps ${continuity.doNotReplay.join(', ') || 'none'} are restored from the checkpoint, not re-run`
        : 'Without a checkpoint completed work would run again',
    },
    {
      id: 'path',
      label: 'Approved recovery path is configured',
      pass: webhookConfigured,
      detail: webhookConfigured ? 'Recovery webhook registered by the integration' : 'No recovery webhook',
    },
    {
      id: 'sandbox',
      label: 'Operation is sandboxed and non-destructive',
      pass: diagnosis.component.mode !== 'live',
      detail: `Integration mode: ${diagnosis.component.mode}`,
    },
  ];

  const base = { checks, failedStepId: diagnosis.stepId };

  if (!step?.idempotent) {
    return {
      ...base,
      supported: false,
      safe: false,
      action: 'escalate',
      rationale: 'The failed operation is not idempotent and its outcome is not known. Fluxera will not replay it and hands the incident to a person.',
    };
  }
  if (diagnosis.error.category === 'PROVIDER_OUTAGE') {
    if (fallbackId && cp && webhookConfigured) {
      const fb = byId(fallbackId);
      return {
        ...base,
        supported: true,
        safe: true,
        action: 'fallback',
        fallbackIntegration: fallbackId,
        checkpointId: cp.id,
        rationale: `The provider is in a sustained outage. ${fb?.name ?? fallbackId} is the approved fallback, so recovery resumes from ${cp.id} using it.`,
      };
    }
    return {
      ...base,
      supported: false,
      safe: false,
      action: 'escalate',
      rationale: 'Sustained provider outage and no approved fallback is available.',
    };
  }
  if (!info.retryable) {
    return {
      ...base,
      supported: false,
      safe: false,
      action: 'escalate',
      rationale: `${diagnosis.error.category} cannot be fixed by replaying the call.`,
    };
  }
  if (cp && webhookConfigured) {
    return {
      ...base,
      supported: true,
      safe: true,
      action: 'resume_from_checkpoint',
      checkpointId: cp.id,
      rationale: `Transient failure on an idempotent call. Resume from ${cp.id} so completed work is not repeated.`,
    };
  }
  if (!continuity.doNotReplay.length && webhookConfigured) {
    return {
      ...base,
      supported: true,
      safe: true,
      action: 'retry',
      rationale: 'Transient failure and no side effects have been committed yet, so a plain retry is safe.',
    };
  }
  return {
    ...base,
    supported: false,
    safe: false,
    action: 'escalate',
    rationale: 'No checkpoint is available and earlier side effects would be replayed.',
  };
}
