// Sandbox price card. These are illustrative rates used to make cost
// telemetry tangible; they are not real vendor billing.
export const PRICE = {
  ai: { model: 'sandbox-llm-1', inPerTok: 5 / 1e6, outPerTok: 15 / 1e6 },
  memory: 0.0006,
  internal: 0.0003,
  db: 0.0002,
  crm: 0.004,
  notify: 0.0075,
  email: 0.003,
  analytics: 0.001,
  payments: 0.003,
};

export const PRICE_NOTE =
  'Costs are computed from a sandbox price card (illustrative rates), not from real vendor invoices.';
