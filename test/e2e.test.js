import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startApp } from './helpers.js';

const leaves = (state, ex) => ex.nodes.filter((n) => n.type === 'api');

test('static site and health endpoint are served', async () => {
  const t = await startApp();
  try {
    assert.equal((await t.call('/healthz')).body.ok, true);
    const page = await t.call('/');
    assert.equal(page.status, 200);
    assert.match(page.body, /Fluxera/);
    assert.equal((await t.call('/js/app.js')).status, 200);
    assert.equal((await t.call('/..%2f..%2fetc/passwd')).status === 200, false);
  } finally { await t.close(); }
});

test('integrations expose six API categories and are probed live', async () => {
  const t = await startApp();
  try {
    await new Promise((r) => setTimeout(r, 300));
    const { body } = await t.call('/api/state');
    assert.equal(new Set(body.integrations.map((i) => i.category)).size, 6);
    assert.ok(body.integrations.every((i) => i.status === 'healthy'));
    assert.ok(body.integrations.every((i) => ['sandbox', 'simulated'].includes(i.mode)));
  } finally { await t.close(); }
});

test('resume scenario: fail, analyze, recover from checkpoint, verify', async () => {
  const t = await startApp();
  try {
    const s = await t.runScenario('resume');
    const original = s.executions.find((e) => e.kind === 'original');
    const recovery = s.executions.find((e) => e.kind === 'recovery');
    assert.equal(original.status, 'failed');
    assert.equal(recovery.status, 'success');
    assert.equal(recovery.recoveryOf, original.id);
    assert.equal(s.incident.status, 'verified');
    assert.equal(s.incident.decision.action, 'resume_from_checkpoint');
    assert.ok(s.incident.verification.checks.every((c) => c.pass));

    const failed = leaves(s, original).find((n) => n.status === 'error');
    assert.equal(failed.errorCategory, 'TEMPORARY_UNAVAILABLE');
    assert.equal(failed.attempts.length, 1);
    assert.ok(failed.durationMs >= 0 && failed.cost > 0);

    const types = new Set(original.nodes.map((n) => n.type));
    for (const k of ['workflow', 'agent', 'memory', 'tool', 'api', 'step', 'checkpoint']) assert.ok(types.has(k), k);

    const c = s.incident.continuity.buckets;
    assert.ok(c.completed.length && c.failed.length && c.waiting.length && c.unresolved.length && c.safeToContinue.length);

    const executedInRecovery = recovery.nodes.filter((n) => n.type === 'step' && n.status !== 'skipped').map((n) => n.stepId);
    for (const id of c.completed) assert.equal(executedInRecovery.includes(id), false, `${id} must not be replayed`);

    assert.equal(s.ledger.crmCases.length, 1);
    assert.equal(s.ledger.duplicateSideEffects, 0);
    assert.equal(s.ledger.liveOperations, 0);
    assert.equal(s.ledger.refunds.fundsMoved, 0);
  } finally { await t.close(); }
});

test('cost sheet is labeled and internally consistent after recovery', async () => {
  const t = await startApp();
  try {
    const s = await t.runScenario('resume');
    const r = Object.fromEntries(s.cost.rows.map((x) => [x.key, x]));
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const original = s.executions.find((e) => e.kind === 'original');
    const recovery = s.executions.find((e) => e.kind === 'recovery');
    assert.ok(near(r.observed.value, original.totals.cost));
    assert.ok(near(r.before.value + r.failed.value, r.observed.value));
    assert.ok(near(r.recovery.value, recovery.totals.cost));
    assert.ok(near(r.total.value, original.totals.cost + recovery.totals.cost));
    assert.equal(r.retry.value, 0);
    assert.ok(r.failed.value > 0);
    assert.equal(r.avoidable.label, 'Estimated');
    assert.equal(r.verified.label, 'Verified');
    assert.ok(r.verified.value > 0);
    assert.ok(near(r.verified.value, r.before.value), 'restored work equals pre-failure cost');
  } finally { await t.close(); }
});

test('fallback scenario recovers through the approved fallback integration', async () => {
  const t = await startApp();
  try {
    const s = await t.runScenario('fallback');
    assert.equal(s.incident.decision.action, 'fallback');
    assert.equal(s.incident.status, 'verified');
    const recovery = s.executions.find((e) => e.kind === 'recovery');
    assert.ok(leaves(s, recovery).some((n) => n.integration === 'email-fallback' && n.status === 'success'));
    assert.equal(s.ledger.duplicateSideEffects, 0);
  } finally { await t.close(); }
});

test('escalate scenario never replays and never claims verification', async () => {
  const t = await startApp();
  try {
    const s = await t.runScenario('escalate');
    assert.equal(s.incident.status, 'escalated');
    assert.equal(s.incident.decision.action, 'escalate');
    assert.equal(s.executions.filter((e) => e.kind === 'recovery').length, 0);
    assert.equal(s.incident.verification, null);
    assert.equal(s.cost.rows.find((x) => x.key === 'verified').value, null);
    assert.equal(s.ledger.refunds.attempted, 1, 'the refund was attempted exactly once');
    assert.equal(s.ledger.refunds.fundsMoved, 0);
    assert.ok(s.incident.escalation.id);
  } finally { await t.close(); }
});

test('manual approval holds recovery until a person approves', async () => {
  const t = await startApp();
  try {
    await t.post('/api/demo/run', { scenario: 'resume', autoRecover: false });
    let s;
    for (let i = 0; i < 200; i += 1) {
      s = (await t.call('/api/state')).body;
      if (s.incident?.status === 'awaiting_approval') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(s.incident.status, 'awaiting_approval');
    assert.equal(s.executions.filter((e) => e.kind === 'recovery').length, 0);
    const ok = await t.post(`/api/incidents/${s.incident.id}/approve`);
    assert.equal(ok.status, 202);
    const done = await t.waitFinal();
    assert.equal(done.incident.status, 'verified');
  } finally { await t.close(); }
});

test('a second run is refused while one is in flight, reset works afterwards', async () => {
  const t = await startApp();
  try {
    const first = await t.post('/api/demo/run', { scenario: 'resume' });
    assert.equal(first.status, 202);
    assert.equal((await t.post('/api/demo/run', { scenario: 'resume' })).status, 409);
    await t.waitFinal();
    assert.equal((await t.post('/api/demo/reset')).status, 200);
    const s = (await t.call('/api/state')).body;
    assert.equal(s.executions.length, 0);
    assert.equal(s.incident, null);
  } finally { await t.close(); }
});

test('the run is repeatable after reset with the same outcome', async () => {
  const t = await startApp();
  try {
    const a = await t.runScenario('resume');
    await t.post('/api/demo/reset');
    const b = await t.runScenario('resume');
    assert.equal(a.incident.status, b.incident.status);
    assert.equal(a.executions.length, b.executions.length);
    assert.equal(b.ledger.crmCases.length, 1);
  } finally { await t.close(); }
});

test('unknown scenario is rejected', async () => {
  const t = await startApp();
  try { assert.equal((await t.post('/api/demo/run', { scenario: 'nope' })).status, 400); } finally { await t.close(); }
});

test('recovery webhook rejects bad signatures and de-duplicates deliveries', async () => {
  const t = await startApp();
  try {
    const bad = await fetch(`${t.base}/integration/recovery-webhook`, {
      method: 'POST', headers: { 'x-fluxera-timestamp': String(Date.now()), 'x-fluxera-signature': 'sha256=00' }, body: '{}',
    });
    assert.equal(bad.status, 401);

    const s = await t.runScenario('resume');
    const action = s.incident.actions[0];
    const body = JSON.stringify(action.payload);
    const ts = String(Date.now());
    const sig = 'sha256=' + createHmac('sha256', t.app.config.webhookSecret).update(`${ts}.${body}`).digest('hex');
    const again = await fetch(`${t.base}/integration/recovery-webhook`, {
      method: 'POST', headers: { 'x-fluxera-timestamp': ts, 'x-fluxera-signature': sig, 'content-type': 'application/json' }, body,
    });
    const json = await again.json();
    assert.equal(again.status, 200);
    assert.equal(json.duplicate, true);
    const after = (await t.call('/api/state')).body;
    assert.equal(after.executions.filter((e) => e.kind === 'recovery').length, 1, 'no second recovery run');
  } finally { await t.close(); }
});

test('sandbox APIs honour idempotency keys', async () => {
  const t = await startApp();
  try {
    const h = { 'content-type': 'application/json', 'idempotency-key': 'k-1' };
    const a = await (await fetch(`${t.base}/stub/crm/v1/cases`, { method: 'POST', headers: h, body: '{}' })).json();
    const b = await (await fetch(`${t.base}/stub/crm/v1/cases`, { method: 'POST', headers: h, body: '{}' })).json();
    assert.equal(a.caseId, b.caseId);
    assert.equal(b.replayed, true);
  } finally { await t.close(); }
});

test('acceptance checks are computed from recorded data', async () => {
  const t = await startApp();
  try {
    const idle = (await t.call('/api/state')).body;
    assert.ok(idle.acceptance.every((a) => a.status === 'pending'));
    const s = await t.runScenario('resume');
    const by = Object.fromEntries(s.acceptance.map((a) => [a.area, a.status]));
    for (const k of ['API coverage', 'Instrumentation', 'Failure', 'Work continuity', 'Recovery', 'Verification', 'Costs', 'Website', 'Safety']) assert.equal(by[k], 'pass', k);
  } finally { await t.close(); }
});
