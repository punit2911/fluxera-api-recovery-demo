import { createHash } from 'node:crypto';
import { sleep } from './runtime.js';
import { PRICE } from './pricing.js';

const LATENCY = {
  ai: 900,
  memory: 220,
  internal: 180,
  db: 140,
  crm: 420,
  notify: 260,
  email: 200,
  analytics: 150,
  payments: 330,
};

const short = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

// State behind the sandbox APIs. Nothing here talks to a real provider:
// "delivered" messages land in an in-memory outbox and refunds never move funds.
export class Sandbox {
  constructor(defaults = {}) {
    this.defaults = { notifyFailCount: 1, ...defaults };
    this.reset();
  }

  reset() {
    this.config = {
      notifyMode: 'flaky', // flaky | down
      notifyFailCount: this.defaults.notifyFailCount,
      paymentMode: 'ok', // ok | ambiguous
    };
    this.crmCases = new Map();
    this.outbox = [];
    this.emailOutbox = [];
    this.analytics = new Map();
    this.audit = new Map();
    this.refunds = [];
    this.notifyCalls = new Map();
    this.replays = 0;
  }

  configureForScenario(scenario) {
    this.config.notifyMode = scenario === 'fallback' ? 'down' : 'flaky';
    this.config.paymentMode = scenario === 'escalate' ? 'ambiguous' : 'ok';
  }

  ledger(runId = null) {
    const match = (k) => runId === null || String(k).startsWith(`${runId}:`);
    const crm = [...this.crmCases.entries()].filter(([k]) => match(k));
    const notes = this.outbox.filter((m) => match(m.key));
    const emails = this.emailOutbox.filter((m) => match(m.key));
    const analytics = [...this.analytics.entries()].filter(([k]) => match(k));
    const audit = [...this.audit.entries()].filter(([k]) => match(k));
    const refunds = this.refunds.filter((r) => match(r.key));
    const dupes = (list) => list.length - new Set(list).size;
    return {
      crmCases: crm.map(([key, c]) => ({ key, caseId: c.caseId })),
      notifications: notes.map((m) => ({ key: m.key, id: m.id, channel: m.channel })),
      emails: emails.map((m) => ({ key: m.key, id: m.id })),
      analyticsEvents: analytics.length,
      auditEntries: audit.length,
      refunds: {
        attempted: refunds.length,
        settled: refunds.filter((r) => r.state === 'settled').length,
        unknownOutcome: refunds.filter((r) => r.state === 'unknown').length,
        fundsMoved: 0,
      },
      duplicateSideEffects:
        dupes(crm.map(([k]) => k)) + dupes(notes.map((m) => m.key)) + dupes(emails.map((m) => m.key)),
      idempotentReplaysServed: this.replays,
      liveOperations: 0,
    };
  }
}

function send(res, status, body, { cost = 0, headers = {} } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-sandbox': 'true',
    'x-sandbox-cost-usd': String(cost),
    ...headers,
  });
  res.end(payload);
}

const fail = (res, status, category, message, retryable, cost = 0, headers = {}) =>
  send(res, status, { error: { category, message, retryable } }, { cost, headers });

const SERVICES = {
  ai: 'simulated',
  memory: 'sandbox',
  internal: 'sandbox',
  db: 'sandbox',
  crm: 'sandbox',
  notify: 'sandbox',
  email: 'sandbox',
  analytics: 'sandbox',
  payments: 'sandbox',
};

export function createStubHandler(sandbox) {
  return async function handle(req, res, url, body) {
    const { pathname } = url;
    const m = pathname.match(/^\/stub\/([a-z]+)\/(.*)$/);
    if (!m) return false;
    const [, svc, rest] = m;
    if (!(svc in SERVICES)) {
      fail(res, 404, 'BAD_REQUEST', 'Unknown sandbox service', false);
      return true;
    }
    const idemKey = req.headers['idempotency-key'];

    if (rest === 'health') {
      send(res, 200, { status: 'ok', service: svc, mode: SERVICES[svc] });
      return true;
    }

    await sleep(LATENCY[svc]);

    // --- Model API (simulated, deterministic) ---
    if (svc === 'ai' && req.method === 'POST' && rest === 'v1/complete') {
      const input = body?.input ?? {};
      const promptSize = JSON.stringify(input).length;
      const inputTokens = 1450 + Math.ceil(promptSize / 4);
      const outputTokens = 540;
      const cost = inputTokens * PRICE.ai.inPerTok + outputTokens * PRICE.ai.outPerTok;
      send(
        res,
        200,
        {
          id: `cmpl_sbx_${short(promptSize)}`,
          model: PRICE.ai.model,
          simulated: true,
          text:
            `Hi ${input.customerName ?? 'there'}, order ${input.orderId ?? ''} is delayed in transit. ` +
            `As a ${input.tier ?? 'valued'} customer you qualify for a goodwill refund and priority re-ship. ` +
            `We have opened a case and will confirm the next steps shortly.`,
          usage: { inputTokens, outputTokens },
        },
        { cost },
      );
      return true;
    }

    // --- Memory / retrieval API ---
    if (svc === 'memory' && req.method === 'GET' && /^v1\/customers\/[\w-]+\/context$/.test(rest)) {
      send(
        res,
        200,
        {
          customerId: rest.split('/')[2],
          summary: 'Prefers email, two earlier delivery delays resolved with goodwill credit.',
          recentTickets: ['T-8812 late parcel (resolved)', 'T-9021 address change (resolved)'],
          knowledgeBase: ['Refund policy: delayed orders over 5 days are refund eligible.'],
        },
        { cost: PRICE.memory },
      );
      return true;
    }

    // --- Internal microservice ---
    if (svc === 'internal' && req.method === 'GET' && /^v1\/accounts\/[\w-]+$/.test(rest)) {
      send(
        res,
        200,
        { accountId: rest.split('/')[2], tier: 'gold', standing: 'good', refundEligible: true },
        { cost: PRICE.internal },
      );
      return true;
    }

    // --- Database / data API ---
    if (svc === 'db' && req.method === 'GET' && /^v1\/orders\/[\w-]+$/.test(rest)) {
      send(
        res,
        200,
        {
          orderId: rest.split('/')[2],
          status: 'delayed',
          daysLate: 6,
          items: [{ sku: 'SKU-4471', qty: 1 }],
          total: 84.5,
          currency: 'USD',
        },
        { cost: PRICE.db },
      );
      return true;
    }
    if (svc === 'db' && req.method === 'POST' && rest === 'v1/audit') {
      const key = idemKey ?? `anon:${short(JSON.stringify(body))}`;
      let replayed = false;
      if (sandbox.audit.has(key)) {
        replayed = true;
        sandbox.replays += 1;
      } else {
        sandbox.audit.set(key, { entry: body, at: Date.now() });
      }
      send(res, 201, { auditId: `aud_${short(key)}`, replayed }, { cost: replayed ? 0 : PRICE.db });
      return true;
    }

    // --- Third-party CRM (idempotent create) ---
    if (svc === 'crm' && req.method === 'POST' && rest === 'v1/cases') {
      const key = idemKey ?? `anon:${short(JSON.stringify(body))}`;
      const existing = sandbox.crmCases.get(key);
      if (existing) {
        sandbox.replays += 1;
        send(res, 200, { ...existing, replayed: true });
        return true;
      }
      const record = {
        caseId: `CASE-${1000 + sandbox.crmCases.size + 1}`,
        status: 'open',
        subject: body?.subject ?? 'Support case',
      };
      sandbox.crmCases.set(key, record);
      send(res, 201, { ...record, replayed: false }, { cost: PRICE.crm });
      return true;
    }

    // --- Notification gateway (the controlled failure lives here) ---
    if (svc === 'notify' && req.method === 'POST' && rest === 'v1/messages') {
      const key = idemKey ?? `anon:${short(JSON.stringify(body))}`;
      const delivered = sandbox.outbox.find((m) => m.key === key);
      if (delivered) {
        sandbox.replays += 1;
        send(res, 200, { id: delivered.id, status: 'delivered_to_sandbox', replayed: true });
        return true;
      }
      const calls = (sandbox.notifyCalls.get(key) ?? 0) + 1;
      sandbox.notifyCalls.set(key, calls);

      if (sandbox.config.notifyMode === 'down') {
        fail(
          res,
          503,
          'PROVIDER_OUTAGE',
          'Notification provider reports a sustained outage (sandbox)',
          true,
          PRICE.notify,
          { 'retry-after': '900' },
        );
        return true;
      }
      if (calls <= sandbox.config.notifyFailCount) {
        fail(
          res,
          503,
          'TEMPORARY_UNAVAILABLE',
          'Notification gateway temporarily unavailable (sandbox, controlled failure)',
          true,
          PRICE.notify,
          { 'retry-after': '1' },
        );
        return true;
      }
      const msg = {
        id: `msg_sbx_${short(key)}`,
        key,
        channel: 'sms-sandbox',
        to: 'customer@example.invalid',
        deliveredToSandboxSink: true,
      };
      sandbox.outbox.push(msg);
      send(res, 201, { id: msg.id, status: 'delivered_to_sandbox', replayed: false }, { cost: PRICE.notify });
      return true;
    }

    // --- Approved fallback channel ---
    if (svc === 'email' && req.method === 'POST' && rest === 'v1/messages') {
      const key = idemKey ?? `anon:${short(JSON.stringify(body))}`;
      const existing = sandbox.emailOutbox.find((m) => m.key === key);
      if (existing) {
        sandbox.replays += 1;
        send(res, 200, { id: existing.id, status: 'delivered_to_sandbox', replayed: true });
        return true;
      }
      const msg = { id: `eml_sbx_${short(key)}`, key, to: 'customer@example.invalid' };
      sandbox.emailOutbox.push(msg);
      send(res, 201, { id: msg.id, status: 'delivered_to_sandbox', replayed: false }, { cost: PRICE.email });
      return true;
    }

    // --- Third-party analytics ---
    if (svc === 'analytics' && req.method === 'POST' && rest === 'v1/events') {
      const key = idemKey ?? `anon:${short(JSON.stringify(body))}`;
      let replayed = false;
      if (sandbox.analytics.has(key)) {
        replayed = true;
        sandbox.replays += 1;
      } else {
        sandbox.analytics.set(key, body);
      }
      send(res, 202, { accepted: true, replayed }, { cost: replayed ? 0 : PRICE.analytics });
      return true;
    }

    // --- Payment API (sandbox, never moves funds) ---
    if (svc === 'payments' && req.method === 'POST' && rest === 'v1/refunds') {
      const key = idemKey ?? `anon:${short(JSON.stringify(body))}`;
      if (sandbox.config.paymentMode === 'ambiguous') {
        sandbox.refunds.push({ key, state: 'unknown', amount: body?.amount ?? 0 });
        fail(
          res,
          500,
          'AMBIGUOUS_OUTCOME',
          'Upstream timed out after the request was accepted; the refund outcome is unknown (sandbox)',
          false,
          PRICE.payments,
        );
        return true;
      }
      sandbox.refunds.push({ key, state: 'settled', amount: body?.amount ?? 0 });
      send(res, 201, { refundId: `rf_sbx_${short(key)}`, state: 'settled', sandbox: true }, { cost: PRICE.payments });
      return true;
    }

    fail(res, 404, 'BAD_REQUEST', `No sandbox route for ${req.method} ${pathname}`, false);
    return true;
  };
}
