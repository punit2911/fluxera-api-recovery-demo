const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid && kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

function apply(el, attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

// ---------- formatting ----------
export const money = (v, digits = 4) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  return `$${abs >= 1 ? v.toFixed(2) : v.toFixed(digits)}`;
};

export const ms = (v) => {
  if (v === null || v === undefined) return '—';
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
};

export const clock = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const offset = (t, base) => (t && base ? `+${((t - base) / 1000).toFixed(1)}s` : '');

// ---------- shared pieces ----------
const STATUS = {
  success: ['ok', 'Success'],
  failed: ['err', 'Failed'],
  error: ['err', 'Failed'],
  running: ['run', 'Running'],
  skipped: ['skip', 'Restored'],
  verified: ['ok', 'Verified'],
  escalated: ['err', 'Escalated'],
  pending: ['muted', 'Pending'],
};

export function statusPill(status, label) {
  const [kind, text] = STATUS[status] ?? ['muted', status];
  return h('span', { class: `pill ${kind}` }, label ?? text);
}

export function labelTag(label) {
  const key = String(label).toLowerCase();
  const cls = key.startsWith('observed') ? 'observed' : key;
  return h('span', { class: `tag ${cls}` }, label);
}

export function modeTag(mode) {
  if (!mode) return null;
  const text = mode === 'simulated' ? 'Simulated' : mode === 'sandbox' ? 'Sandbox' : mode;
  return h('span', { class: `tag ${mode}` }, text);
}

export function idChip(id) {
  return h('span', { class: 'id-chip' }, id ?? '—');
}

export function sectionHead({ eyebrow, title, lede, tags }) {
  return h(
    'div',
    { class: 'sec-head' },
    h(
      'div',
      null,
      h('div', { class: 'eyebrow' }, eyebrow),
      h('h2', null, title),
      lede ? h('p', { class: 'lede' }, lede) : null,
    ),
    tags && tags.length ? h('div', { class: 'sec-tags' }, tags) : null,
  );
}

export function empty(title, text, action) {
  return h('div', { class: 'empty' }, h('strong', null, title), text, action ?? null);
}

export function kpi(label, value, sub, tone) {
  return h(
    'div',
    { class: 'card kpi' },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: `kpi-value ${tone ?? ''}` }, value),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null,
  );
}

export function latestRunExecutions(state) {
  const runId = state.lastRun?.runId;
  const list = state.executions.filter((e) => e.runId === runId);
  const original = list.find((e) => e.kind === 'original') ?? null;
  const recovery = list.find((e) => e.kind === 'recovery') ?? null;
  return { list, original, recovery };
}
