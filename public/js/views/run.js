import { empty, h, idChip, labelTag, latestRunExecutions, money, ms, sectionHead, statusPill } from '../dom.js';

const LABELS = {
  'model-gateway': 'Model Gateway',
  'customer-memory': 'Customer Memory',
  'accounts-service': 'Accounts Service',
  'orders-db': 'Orders Data API',
  'crm-sandbox': 'CRM',
  'notify-gateway': 'Notification Gateway',
  'analytics-saas': 'Analytics',
  'payments-sandbox': 'Payments',
  'email-fallback': 'Email fallback',
};

function niceStep(span) {
  const steps = [250, 500, 1000, 2000, 2500, 5000, 10000];
  return steps.find((s) => span / s <= 7) ?? 10000;
}

function timeline(state) {
  const { list } = latestRunExecutions(state);
  const bars = [];
  for (const ex of list) {
    for (const node of ex.nodes) {
      if (node.type !== 'api') continue;
      for (const a of node.attempts) {
        bars.push({ ex, node, a, integration: node.integration });
      }
    }
  }
  if (!bars.length) return null;

  const now = state.meta.serverTime;
  const t0 = Math.min(...bars.map((b) => b.a.startedAt));
  const end = (b) => (b.a.durationMs == null ? Math.max(now, b.a.startedAt + 400) : b.a.startedAt + b.a.durationMs);
  const t1 = Math.max(...bars.map(end));
  const span = Math.max(t1 - t0, 500);
  const pct = (t) => ((t - t0) / span) * 100;

  const lanes = [];
  for (const b of bars) if (!lanes.includes(b.integration)) lanes.push(b.integration);

  const step = niceStep(span);
  const ticks = [];
  for (let t = 0; t <= span; t += step) ticks.push(t);

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'lanes' },
      lanes.map((lane) =>
        h(
          'div',
          { class: 'lane' },
          h('div', { class: 'lane-label' }, LABELS[lane] ?? lane),
          h(
            'div',
            { class: 'lane-track' },
            bars
              .filter((b) => b.integration === lane)
              .map((b) => {
                const left = pct(b.a.startedAt);
                const width = Math.max(((end(b) - b.a.startedAt) / span) * 100, 0.9);
                const cls = b.a.status === 'success' ? 'ok' : b.a.status === 'error' ? 'err' : 'run';
                const tip = `${b.node.name} · attempt ${b.a.n} · ${b.a.status}${b.a.durationMs != null ? ` · ${ms(b.a.durationMs)}` : ''} · ${money(b.a.cost)}${b.ex.kind === 'recovery' ? ' · recovery run' : ''}`;
                return h(
                  'div',
                  {
                    class: `bar ${cls} ${b.ex.kind === 'recovery' ? 'rec' : ''}`,
                    style: `left:${left.toFixed(2)}%;width:${Math.min(width, 100 - left).toFixed(2)}%`,
                    title: tip,
                  },
                  width > 6 ? `#${b.a.n}${b.a.httpStatus && b.a.status === 'error' ? ` ${b.a.httpStatus}` : ''}` : '',
                );
              }),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'axis' },
      h('div'),
      h(
        'div',
        { class: 'axis-track' },
        ticks.map((t) => h('span', { style: `left:${((t / span) * 100).toFixed(2)}%` }, `${(t / 1000).toFixed(t % 1000 ? 2 : 0)}s`)),
      ),
    ),
    h(
      'div',
      { class: 'legend' },
      h('span', null, h('i', { class: 'l-ok' }), 'Succeeded'),
      h('span', null, h('i', { class: 'l-err' }), 'Failed attempt'),
      h('span', null, h('i', { class: 'l-run' }), 'In flight'),
      h('span', null, h('i', { class: 'l-rec' }), 'Linked recovery run'),
    ),
  );
}

function executionsTable(state, actions) {
  const latestRun = state.lastRun?.runId;
  const rows = [...state.executions].reverse();
  return h(
    'div',
    { class: 'tbl-wrap' },
    h(
      'table',
      { class: 't' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          ['Execution ID', 'Workflow', 'Kind', 'Status', 'Duration', 'Attempts', 'Cost', 'Linked to'].map((c, i) =>
            h('th', { class: i >= 4 && i <= 6 ? 'r' : '' }, c),
          ),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map((ex) =>
          h(
            'tr',
            { class: ex.runId === latestRun ? 'is-latest' : '' },
            h('td', null, idChip(ex.id)),
            h('td', { class: 'mono', style: 'font-size:12px' }, ex.workflowName),
            h('td', null, h('span', { class: `tag ${ex.kind === 'recovery' ? 'simulated' : 'cat'}` }, ex.kind)),
            h('td', null, statusPill(ex.status)),
            h('td', { class: 'r' }, ms(ex.durationMs)),
            h(
              'td',
              { class: 'r' },
              `${ex.totals.attempts}`,
              ex.totals.failedAttempts ? h('span', { class: 'muted' }, ` (${ex.totals.failedAttempts} failed)`) : null,
            ),
            h('td', { class: 'r money' }, money(ex.totals.cost)),
            h(
              'td',
              null,
              ex.recoveryOf
                ? h('span', null, 'recovers ', idChip(ex.recoveryOf))
                : state.executions.find((e) => e.recoveryOf === ex.id)
                  ? h('span', null, 'recovered by ', idChip(state.executions.find((e) => e.recoveryOf === ex.id).id))
                  : h('span', { class: 'muted' }, '—'),
            ),
          ),
        ),
      ),
    ),
  );
}

export function renderRun(state, ui, actions) {
  const tl = state.executions.length ? timeline(state) : null;
  return h(
    'div',
    null,
    sectionHead({
      eyebrow: '02 · Run',
      title: 'Live execution timeline',
      lede: 'Every API attempt on a swimlane for its integration. Failed attempts are red, the linked recovery run is outlined. Execution IDs, status, duration, attempts and costs come straight from recorded telemetry.',
      tags: [h('span', { class: 'tag cat' }, state.meta.telemetry)],
    }),
    state.executions.length
      ? h(
          'div',
          { class: 'stack' },
          h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'API attempts over time', labelTag('Observed')), tl),
          h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Executions'), executionsTable(state, actions)),
        )
      : empty(
          'Nothing has run yet',
          'Start the scenario to emit a real execution tree from the instrumented workflow.',
          h(
            'button',
            { class: 'btn btn-primary', onclick: () => actions.run() },
            'Run Demo',
          ),
        ),
  );
}
