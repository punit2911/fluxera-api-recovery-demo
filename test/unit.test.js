import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../src/signing.js';
import { decide } from '../src/analysis.js';
import { computeCostSheet } from '../src/costs.js';
import { PRICE } from '../src/pricing.js';

test('signature verifies for a fresh, untampered body', () => {
  const ts = String(Date.now());
  assert.equal(verify('s', ts, '{"a":1}', sign('s', ts, '{"a":1}')), true);
});

test('signature rejects a tampered body, wrong secret and stale timestamp', () => {
  const ts = String(Date.now());
  const sig = sign('s', ts, '{"a":1}');
  assert.equal(verify('s', ts, '{"a":2}', sig), false);
  assert.equal(verify('other', ts, '{"a":1}', sig), false);
  const old = String(Date.now() - 10 * 60 * 1000);
  assert.equal(verify('s', old, '{"a":1}', sign('s', old, '{"a":1}')), false);
  assert.equal(verify('s', ts, '{"a":1}', undefined), false);
});

const diag = (category, integration = 'notify-gateway') => ({
  stepId: 's6',
  error: { category },
  component: { integration, mode: 'sandbox', idempotencyKey: 'k' },
});
const cont = (idempotent = true, checkpoint = { id: 'cp_s5', afterStep: 's5' }, doNotReplay = ['s5']) => ({
  steps: [{ id: 's6', idempotent }],
  checkpoint,
  doNotReplay,
});

test('policy: transient failure on idempotent call resumes from checkpoint', () => {
  const d = decide({}, diag('TEMPORARY_UNAVAILABLE'), cont());
  assert.equal(d.action, 'resume_from_checkpoint');
  assert.equal(d.checkpointId, 'cp_s5');
  assert.equal(d.safe, true);
});

test('policy: provider outage with approved fallback uses the fallback', () => {
  const d = decide({}, diag('PROVIDER_OUTAGE'), cont());
  assert.equal(d.action, 'fallback');
  assert.equal(d.fallbackIntegration, 'email-fallback');
});

test('policy: provider outage without a fallback escalates', () => {
  const d = decide({}, diag('PROVIDER_OUTAGE', 'crm-sandbox'), cont());
  assert.equal(d.action, 'escalate');
});

test('policy: non-idempotent operation is never replayed', () => {
  const d = decide({}, diag('AMBIGUOUS_OUTCOME', 'payments-sandbox'), cont(false));
  assert.equal(d.action, 'escalate');
  assert.equal(d.safe, false);
});

test('policy: plain retry only when nothing was committed and no checkpoint exists', () => {
  assert.equal(decide({}, diag('TEMPORARY_UNAVAILABLE'), cont(true, null, [])).action, 'retry');
  assert.equal(decide({}, diag('TEMPORARY_UNAVAILABLE'), cont(true, null, ['s5'])).action, 'escalate');
});

test('policy: non-recoverable categories escalate', () => {
  assert.equal(decide({}, diag('AUTH_FAILED'), cont()).action, 'escalate');
  assert.equal(decide({}, diag('BAD_REQUEST'), cont()).action, 'escalate');
});

test('policy: missing webhook blocks automatic recovery', () => {
  const d = decide({}, diag('TEMPORARY_UNAVAILABLE'), cont(), { webhookConfigured: false });
  assert.notEqual(d.action, 'resume_from_checkpoint');
});

test('cost sheet: verified savings stay empty until recovery is verified', () => {
  const leaf = (id, cost, status = 'success', attempts = [{ n: 1, status: status === 'error' ? 'error' : 'success', cost }]) => ({
    id, type: 'api', status, cost, attempts, integration: 'orders-db', apiCategory: 'database', parentId: null,
  });
  const original = { id: 'o', workflowName: 'w' };
  const nodes = { o: [leaf('a', 0.01), leaf('b', 0.02, 'error', [{ n: 1, status: 'error', cost: 0.01 }, { n: 2, status: 'error', cost: 0.01 }])] };
  const sheet = computeCostSheet({ original, recovery: null, nodesOf: (id) => nodes[id] ?? [], incident: { verification: null }, assumptions: { incidentsPerMonth: 10 } });
  const row = (k) => sheet.rows.find((r) => r.key === k);
  assert.ok(Math.abs(row('observed').value - 0.03) < 1e-12);
  assert.ok(Math.abs(row('failed').value - 0.02) < 1e-12);
  assert.ok(Math.abs(row('retry').value - 0.01) < 1e-12);
  assert.equal(row('verified').value, null);
  assert.equal(row('verified').label, 'Verified');
  assert.equal(row('avoidable').label, 'Estimated');
});

test('model cost is computed from token usage', () => {
  const c = 2000 * PRICE.ai.inPerTok + 500 * PRICE.ai.outPerTok;
  assert.ok(Math.abs(c - 0.0175) < 1e-9);
});
