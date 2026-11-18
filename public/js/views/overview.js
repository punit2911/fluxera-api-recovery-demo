import { h, kpi, labelTag, modeTag, money, ms, sectionHead } from '../dom.js';

const STATUS_TEXT = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', unknown: 'Checking' };
const DOT = { healthy: 'ok', degraded: 'warn', down: 'err', unknown: '' };

function integrationCard(i) {
  return h(
    'article',
    { class: `card integ ${i.status === 'degraded' ? 'is-degraded' : ''} ${i.status === 'down' ? 'is-down' : ''}` },
    h(
      'div',
      { class: 'integ-top' },
      h('div', null, h('div', { class: 'integ-name' }, i.name), h('div', { class: 'integ-type' }, i.type)),
      modeTag(i.mode),
    ),
    h('div', { class: 'tags-row' }, h('span', { class: 'tag cat' }, i.categoryLabel)),
    h('p', { class: 'integ-role' }, i.role),
    h(
      'div',
      { class: 'integ-status' },
      h('span', { class: `dot ${DOT[i.status] ?? ''}` }),
      STATUS_TEXT[i.status] ?? i.status,
      i.lastError ? h('span', { class: 'mono muted', style: 'font-weight:500;font-size:11px;text-transform:none' }, i.lastError) : null,
    ),
    h(
      'div',
      { class: 'integ-stats' },
      mini('Calls', String(i.calls)),
      mini('Errors', String(i.errors)),
      mini('p50', i.p50LatencyMs === null ? '—' : ms(i.p50LatencyMs)),
      mini('Cost', i.cost ? money(i.cost) : '—'),
    ),
  );
}

const mini = (label, value) => h('div', { class: 'mini' }, h('b', null, value), h('span', null, label));

function inventoryCard(title, items) {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-title' }, title, h('span', { class: 'mono' }, String(items.length))),
    h('ul', { class: 'inv-list' }, items.map((i) => h('li', null, h('b', null, i.name), h('span', null, i.role)))),
  );
}

export function renderOverview(state) {
  const integ = state.integrations;
  const healthy = integ.filter((i) => i.status === 'healthy').length;
  const categories = new Set(integ.map((i) => i.category)).size;
  const incidents = state.incidents;
  const verified = incidents.filter((i) => i.status === 'verified').length;
  const failures = state.executions.filter((e) => e.kind === 'original' && e.status === 'failed').length;
  const observed = state.executions.reduce((s, e) => s + e.totals.cost, 0);

  return h(
    'div',
    null,
    sectionHead({
      eyebrow: '01 · Connect',
      title: 'Connected software stack',
      lede: 'Agents, workflows, tools, memory and the APIs behind them. Health comes from a live probe of each endpoint combined with the outcome of the most recent recorded call.',
      tags: [labelTag('Sandbox'), labelTag('Simulated')],
    }),
    h(
      'div',
      { class: 'grid g5', style: 'margin-bottom:14px' },
      kpi('Integrations', `${integ.length}`, `${healthy} healthy right now`),
      kpi('API categories', `${categories}`, 'AI, memory, internal, third-party, data, tool'),
      kpi('Executions', `${state.executions.length}`, 'recorded this session'),
      kpi('Failures detected', `${failures}`, `${verified} recovery verified`, failures ? 'warn' : ''),
      kpi('Observed cost', money(observed), 'sandbox price card'),
    ),
    h(
      'div',
      { class: 'grid g4', style: 'margin-bottom:14px' },
      inventoryCard('Agents', state.inventory.agents),
      inventoryCard('Workflows', state.inventory.workflows),
      inventoryCard('Tools', state.inventory.tools),
      inventoryCard('Memory', state.inventory.memory),
    ),
    h('div', { class: 'grid g3' }, integ.map(integrationCard)),
  );
}
