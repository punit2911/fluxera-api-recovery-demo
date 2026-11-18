import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_LABEL, INTEGRATIONS, INVENTORY } from './integrations.js';
import { SCENARIOS } from './integration.js';
import { computeCostSheet } from './costs.js';
import { computeAcceptance } from './acceptance.js';
import { PRICE_NOTE } from './pricing.js';

export function videoInfo(config) {
  if (config.videoUrl) {
    const isFile = /\.(mp4|webm|ogg)(\?.*)?$/i.test(config.videoUrl);
    return { type: isFile ? 'file' : 'embed', src: config.videoUrl };
  }
  for (const f of ['walkthrough.webm', 'walkthrough.mp4']) {
    if (fs.existsSync(path.join(config.publicDir, 'media', f))) return { type: 'file', src: `/media/${f}` };
  }
  return { type: 'none', src: null };
}

function integrationStats(store, health) {
  const leaves = [];
  for (const ex of store.allExecutions()) {
    for (const n of store.nodesOf(ex.id)) if (n.type === 'api') leaves.push(n);
  }
  return INTEGRATIONS.map((i) => {
    const mine = leaves.filter((n) => n.integration === i.id);
    const attempts = mine.flatMap((n) => n.attempts.map((a) => ({ ...a, at: a.startedAt })));
    const finished = attempts.filter((a) => a.status !== 'running').sort((a, b) => a.at - b.at);
    const durations = finished.map((a) => a.durationMs).filter((d) => d != null).sort((a, b) => a - b);
    const p50 = durations.length ? durations[Math.floor(durations.length / 2)] : null;
    const last = finished[finished.length - 1] ?? null;
    const probe = health.results.get(i.id);
    let status = 'unknown';
    if (probe) status = !probe.up ? 'down' : last?.status === 'error' ? 'degraded' : 'healthy';
    return {
      ...i,
      categoryLabel: CATEGORY_LABEL[i.category],
      status,
      probeLatencyMs: probe?.latencyMs ?? null,
      checkedAt: probe?.checkedAt ?? null,
      calls: attempts.length,
      errors: attempts.filter((a) => a.status === 'error').length,
      p50LatencyMs: p50,
      cost: mine.reduce((s, n) => s + n.cost, 0),
      lastError: last?.status === 'error' ? last.errorCategory : null,
    };
  });
}

function execSummary(store, ex) {
  const nodes = store.nodesOf(ex.id);
  const leaves = nodes.filter((n) => n.type === 'api');
  return {
    id: ex.id,
    workflowName: ex.workflowName,
    kind: ex.kind,
    status: ex.status,
    runId: ex.runId,
    scenario: ex.scenario,
    recoveryOf: ex.recoveryOf,
    resumedFrom: ex.resumedFrom,
    action: ex.action,
    startedAt: ex.startedAt,
    endedAt: ex.endedAt,
    durationMs: ex.durationMs,
    error: ex.error,
    plan: ex.plan,
    totals: {
      apiCalls: leaves.length,
      attempts: leaves.reduce((s, n) => s + n.attempts.length, 0),
      failedAttempts: leaves.reduce((s, n) => s + n.attempts.filter((a) => a.status === 'error').length, 0),
      cost: leaves.reduce((s, n) => s + n.cost, 0),
    },
    checkpoints: (store.checkpoints.get(ex.id) ?? []).map((c) => ({ id: c.id, afterStep: c.afterStep, savedAt: c.savedAt })),
    nodes,
  };
}

export function buildState(ctx) {
  const { store, sandbox, health, config, runs } = ctx;
  const executions = store.allExecutions();
  const incidents = [...store.incidents.values()];
  const incident = incidents[incidents.length - 1] ?? null;
  const lastRun = runs[runs.length - 1] ?? null;
  const original = incident
    ? store.executions.get(incident.executionId)
    : [...executions].reverse().find((e) => e.kind === 'original') ?? null;
  const recovery = incident?.recoveryExecutionId ? store.executions.get(incident.recoveryExecutionId) : null;
  const video = videoInfo(config);

  const cost = incident
    ? computeCostSheet({
        original,
        recovery,
        nodesOf: (id) => store.nodesOf(id),
        incident,
        assumptions: { incidentsPerMonth: 50 },
      })
    : null;

  return {
    meta: {
      revision: store.revision,
      serverTime: Date.now(),
      telemetry: 'Emulated Fluxera SDK (local tracer). Not connected to a Fluxera tenant.',
      priceNote: PRICE_NOTE,
      scenarios: SCENARIOS,
      speed: ctx.runtime.speed,
      busy: ctx.controlPlane.isBusy(),
      canReset: ctx.controlPlane.canReset(),
      video,
    },
    integrations: integrationStats(store, health),
    inventory: INVENTORY,
    runs,
    lastRun,
    executions: executions.map((e) => execSummary(store, e)),
    incident,
    incidents: incidents.map((i) => ({ id: i.id, status: i.status, executionId: i.executionId })),
    cost,
    ledger: sandbox.ledger(lastRun?.runId ?? null),
    acceptance: computeAcceptance({
      original,
      recovery,
      nodesOf: (id) => store.nodesOf(id),
      incident,
      sandbox,
      video,
      runStarted: Boolean(lastRun),
    }),
  };
}
