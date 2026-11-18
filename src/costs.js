import { CATEGORY_LABEL, byId } from './integrations.js';
import { PRICE_NOTE } from './pricing.js';

const leaves = (nodes) => nodes.filter((n) => n.type === 'api');
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

function bucketOf(nodes, leaf) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  let cur = leaf;
  let tool = false;
  let memory = false;
  while (cur) {
    if (cur.type === 'tool') tool = true;
    if (cur.type === 'memory') memory = true;
    cur = cur.parentId ? map.get(cur.parentId) : null;
  }
  if (leaf.apiCategory === 'ai') return 'model';
  if (memory) return 'memory';
  if (tool) return 'tool';
  return 'api';
}

const BUCKET_LABEL = { model: 'Model', memory: 'Memory', tool: 'Tool', api: 'API (direct)' };

// Builds the unified cost-recovery sheet for one incident. Every row carries a
// label that says what kind of number it is.
export function computeCostSheet({ original, recovery, nodesOf, incident, assumptions }) {
  if (!original) return null;
  const origNodes = nodesOf(original.id);
  const origLeaves = leaves(origNodes);
  const recNodes = recovery ? nodesOf(recovery.id) : [];
  const recLeaves = leaves(recNodes);

  const observedTotal = sum(origLeaves, (n) => n.cost);
  const failedAttempts = origLeaves.flatMap((n) => n.attempts.filter((a) => a.status === 'error'));
  const failedCallCost = sum(failedAttempts, (a) => a.cost);
  const retryWaste = sum(
    failedAttempts.filter((a) => a.n > 1),
    (a) => a.cost,
  );
  const costBeforeFailure = observedTotal - failedCallCost;
  const recoveryCost = recovery ? sum(recLeaves, (n) => n.cost) : null;
  const recoveryDone = recovery && recovery.status !== 'running';

  const restored = recNodes.filter((n) => n.status === 'skipped');
  const restoredCost = sum(restored, (n) => n.originalCost);
  const verified = incident?.verification?.verified === true;
  const verifiedSavings = verified ? restoredCost : null;

  const perIncident = {
    retryWaste,
    replayAvoidance: restoredCost,
  };

  const rows = [
    {
      key: 'observed',
      metric: 'Observed execution cost',
      value: observedTotal,
      label: 'Observed',
      definition: 'Sum of recorded leaf costs on the original execution.',
    },
    {
      key: 'before',
      metric: 'Cost before failure',
      value: costBeforeFailure,
      label: 'Observed',
      definition: 'Leaf costs of work that completed before the failing call.',
    },
    {
      key: 'failed',
      metric: 'Failed-call cost',
      value: failedCallCost,
      label: 'Observed',
      definition: 'Recorded cost of failed API attempts (billed even when the call fails).',
    },
    {
      key: 'retry',
      metric: 'Retry waste',
      value: retryWaste,
      label: 'Observed',
      definition: 'Cost of repeated attempts after the first failure. Included in failed-call cost.',
    },
    {
      key: 'recovery',
      metric: 'Recovery cost',
      value: recoveryCost,
      label: 'Observed after recovery',
      definition: recovery
        ? recoveryDone
          ? 'Sum of recorded leaf costs on the linked recovery execution.'
          : 'Linked recovery execution is still running. Value is partial.'
        : 'No recovery execution exists for this incident.',
      pending: !recoveryDone,
    },
    {
      key: 'total',
      metric: 'End-to-end cost (original + recovery)',
      value: recoveryDone ? observedTotal + recoveryCost : null,
      label: 'Observed after recovery',
      definition: 'Everything spent on this work item across both executions.',
      pending: !recoveryDone,
    },
    {
      key: 'avoidable',
      metric: 'Potential avoidable cost per month',
      value: retryWaste * assumptions.incidentsPerMonth,
      label: 'Estimated',
      definition: `Retry waste from this incident multiplied by an assumed ${assumptions.incidentsPerMonth} similar incidents per month.`,
    },
    {
      key: 'replay',
      metric: 'Projected replay avoidance per month',
      value: restoredCost * assumptions.incidentsPerMonth,
      label: 'Estimated',
      definition: `Cost of completed work that checkpoint recovery would not repeat, multiplied by an assumed ${assumptions.incidentsPerMonth} incidents per month.`,
    },
    {
      key: 'verified',
      metric: 'Verified savings',
      value: verifiedSavings,
      label: 'Verified',
      definition: verified
        ? 'Cost of completed steps restored from the checkpoint instead of re-executed, confirmed by a successful linked recovery execution.'
        : 'Not available. Requires a successful linked recovery execution.',
      pending: !verified,
    },
  ];

  const sections = (nodes, leafList) =>
    leafList.map((n) => ({ node: n, bucket: bucketOf(nodes, n) }));

  const byIntegration = new Map();
  const touch = (id) => {
    if (!byIntegration.has(id)) {
      const i = byId(id);
      byIntegration.set(id, {
        id,
        name: i?.name ?? id,
        type: i?.type ?? '',
        category: i?.category ?? 'tool',
        categoryLabel: CATEGORY_LABEL[i?.category] ?? '',
        original: 0,
        failed: 0,
        recovery: 0,
        calls: 0,
      });
    }
    return byIntegration.get(id);
  };
  for (const n of origLeaves) {
    const row = touch(n.integration);
    row.original += n.cost;
    row.failed += sum(n.attempts.filter((a) => a.status === 'error'), (a) => a.cost);
    row.calls += n.attempts.length;
  }
  for (const n of recLeaves) {
    const row = touch(n.integration);
    row.recovery += n.cost;
    row.calls += n.attempts.length;
  }

  const byCategory = new Map();
  for (const row of byIntegration.values()) {
    const cur = byCategory.get(row.category) ?? {
      category: row.category,
      label: row.categoryLabel,
      original: 0,
      failed: 0,
      recovery: 0,
      calls: 0,
    };
    cur.original += row.original;
    cur.failed += row.failed;
    cur.recovery += row.recovery;
    cur.calls += row.calls;
    byCategory.set(row.category, cur);
  }

  const byComponent = new Map();
  const addComponent = (nodes, list, field) => {
    for (const { node, bucket } of sections(nodes, list)) {
      const cur = byComponent.get(bucket) ?? { bucket, label: BUCKET_LABEL[bucket], original: 0, recovery: 0 };
      cur[field] += node.cost;
      byComponent.set(bucket, cur);
    }
  };
  addComponent(origNodes, origLeaves, 'original');
  addComponent(recNodes, recLeaves, 'recovery');

  const byWorkflow = {
    workflow: original.workflowName,
    original: observedTotal,
    recovery: recoveryCost ?? 0,
    restoredNotRepeated: restoredCost,
  };

  const model = origLeaves.find((n) => n.apiCategory === 'ai');

  return {
    executionId: original.id,
    recoveryExecutionId: recovery?.id ?? null,
    rows,
    perIncident,
    byIntegration: [...byIntegration.values()],
    byCategory: [...byCategory.values()],
    byComponent: [...byComponent.values()],
    byWorkflow,
    modelCost: model ? { name: model.name, cost: model.cost, integration: model.integration } : null,
    restoredSteps: restored.map((n) => ({ stepId: n.stepId, name: n.name, cost: n.originalCost })),
    note: PRICE_NOTE,
  };
}
