export const CATEGORY_LABEL = {
  ai: 'AI / Model API',
  memory: 'Memory API',
  internal: 'Internal API',
  third_party: 'Third-party API',
  database: 'Database / Data API',
  tool: 'Tool API',
};

// Every integration the demo workflow can touch. `mode` is shown in the UI so
// nothing is presented as a live production connection.
export const INTEGRATIONS = [
  {
    id: 'model-gateway',
    name: 'Model Gateway',
    type: 'Model API',
    category: 'ai',
    mode: 'simulated',
    basePath: '/stub/ai',
    role: 'Drafts the customer reply (deterministic simulated model)',
  },
  {
    id: 'customer-memory',
    name: 'Customer Memory',
    type: 'Retrieval API',
    category: 'memory',
    mode: 'sandbox',
    basePath: '/stub/memory',
    role: 'Returns customer and knowledge-base context',
  },
  {
    id: 'accounts-service',
    name: 'Accounts Service',
    type: 'Internal microservice',
    category: 'internal',
    mode: 'sandbox',
    basePath: '/stub/internal',
    role: 'Account tier and standing',
  },
  {
    id: 'orders-db',
    name: 'Orders Data API',
    type: 'Database API',
    category: 'database',
    mode: 'sandbox',
    basePath: '/stub/db',
    role: 'Order lookup and audit-log writes',
  },
  {
    id: 'crm-sandbox',
    name: 'CRM',
    type: 'CRM API',
    category: 'third_party',
    mode: 'sandbox',
    basePath: '/stub/crm',
    role: 'Opens a support case (idempotent create)',
  },
  {
    id: 'notify-gateway',
    name: 'Notification Gateway',
    type: 'Custom HTTP API',
    category: 'tool',
    mode: 'sandbox',
    basePath: '/stub/notify',
    role: 'Workflow tool that messages the customer. Hosts the controlled failure',
  },
  {
    id: 'analytics-saas',
    name: 'Analytics',
    type: 'SaaS API',
    category: 'third_party',
    mode: 'sandbox',
    basePath: '/stub/analytics',
    role: 'Records the resolution event',
  },
  {
    id: 'payments-sandbox',
    name: 'Payments',
    type: 'Payment API',
    category: 'third_party',
    mode: 'sandbox',
    basePath: '/stub/payments',
    role: 'Refund issuing. Sandbox only, never moves funds',
  },
  {
    id: 'email-fallback',
    name: 'Email (approved fallback)',
    type: 'Tool API',
    category: 'tool',
    mode: 'sandbox',
    basePath: '/stub/email',
    role: 'Approved fallback channel for the notification gateway',
  },
];

export const INVENTORY = {
  agents: [{ name: 'support-agent', role: 'Handles delayed-order refund inquiries' }],
  workflows: [{ name: 'support.refund_inquiry_resolution', role: 'End-to-end ticket resolution' }],
  tools: [
    { name: 'crm.create_case', role: 'Opens a CRM case' },
    { name: 'notify.send', role: 'Messages the customer' },
    { name: 'payments.refund', role: 'Issues a refund (sandbox)' },
    { name: 'email.send', role: 'Approved fallback for notify.send' },
  ],
  memory: [{ name: 'customer-memory', role: 'Customer and knowledge-base retrieval' }],
};

export const FALLBACKS = {
  'notify-gateway': 'email-fallback',
};

export const byId = (id) => INTEGRATIONS.find((i) => i.id === id);

export class HealthMonitor {
  constructor() {
    this.results = new Map();
    this.timer = null;
  }

  async probe(origin, integration) {
    const started = performance.now();
    try {
      const res = await fetch(origin + integration.basePath + '/health', {
        signal: AbortSignal.timeout(1500),
      });
      this.results.set(integration.id, {
        up: res.ok,
        latencyMs: Math.round(performance.now() - started),
        checkedAt: Date.now(),
      });
    } catch {
      this.results.set(integration.id, { up: false, latencyMs: null, checkedAt: Date.now() });
    }
  }

  async probeAll(origin) {
    await Promise.all(INTEGRATIONS.map((i) => this.probe(origin, i)));
  }

  start(getOrigin, onChange, intervalMs = 5000) {
    this.stop();
    const tick = async () => {
      const origin = getOrigin();
      if (!origin) return;
      await this.probeAll(origin);
      onChange?.();
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
