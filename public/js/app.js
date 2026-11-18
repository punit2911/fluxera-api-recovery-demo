import { h } from './dom.js';
import { renderOverview } from './views/overview.js';
import { renderRun } from './views/run.js';
import { renderTree } from './views/tree.js';
import { renderDiagnosis } from './views/diagnosis.js';
import { renderContinuity } from './views/continuity.js';
import { renderRecovery } from './views/recovery.js';
import { renderOutcome } from './views/outcome.js';
import { renderCost } from './views/cost.js';
import { renderVideo } from './views/video.js';
import { renderAcceptance } from './views/acceptance.js';

const SECTIONS = [
  ['connect', 'Connect', renderOverview],
  ['run', 'Run', renderRun],
  ['tree', 'Relationships', renderTree],
  ['fail', 'Diagnosis', renderDiagnosis],
  ['continuity', 'Continuity', renderContinuity],
  ['recover', 'Recovery', renderRecovery],
  ['verify', 'Outcome', renderOutcome],
  ['cost', 'Cost sheet', renderCost],
  ['video', 'Video', renderVideo],
  ['acceptance', 'Evidence', renderAcceptance],
];
const FLOW = [
  ['connect', 'Connect'], ['run', 'Run'], ['fail', 'Fail'], ['continuity', 'Analyze'],
  ['recover', 'Recover'], ['verify', 'Verify'], ['cost', 'Account'], ['video', 'Video'],
];
const FINAL = new Set(['verified', 'recovery_failed', 'escalated', 'recovery_not_observed']);

let state = null;
const ui = {
  treeExec: 'original', payloadOpen: false, scenario: 'resume', pace: 'normal', approval: false, follow: true, starting: false,
  set(patch, silent) { Object.assign(ui, patch); if (!silent) render(true); },
};
const hashes = {};
let lastPhase = '';

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { body });
  return body;
}

function toast(text, err) {
  const el = h('div', { class: `toast ${err ? 'err' : ''}` }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

const actions = {
  async run() {
    if (ui.starting || state?.meta.busy) return;
    ui.starting = true; render(true);
    try {
      await api('/api/demo/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: ui.scenario, pace: ui.pace, autoRecover: !ui.approval }) });
      lastPhase = '';
    } catch (e) { toast(e.message, true); }
    ui.starting = false; await refresh();
  },
  async reset() {
    try { await api('/api/demo/reset', { method: 'POST' }); Object.keys(hashes).forEach((k) => delete hashes[k]); ui.treeExec = 'original'; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { toast(e.message, true); }
    await refresh();
  },
  async approve(id) {
    try { await api(`/api/incidents/${id}/approve`, { method: 'POST' }); } catch (e) { toast(e.message, true); }
    await refresh();
  },
};

function flowStatus(s) {
  const inc = s.incident;
  const done = {
    connect: s.integrations.some((i) => i.status !== 'unknown'),
    run: s.executions.length > 0,
    fail: !!inc,
    continuity: !!inc?.continuity,
    recover: !!inc?.decision && (inc.decision.action === 'escalate' || inc.actions.length > 0),
    verify: !!inc && FINAL.has(inc.status),
    cost: !!inc && FINAL.has(inc.status) && !!s.cost,
    video: !!inc && FINAL.has(inc.status) && s.meta.video.type !== 'none',
  };
  const firstOpen = FLOW.findIndex(([k]) => !done[k]);
  return { done, active: firstOpen === -1 ? FLOW.length - 1 : firstOpen };
}

function phaseOf(s) {
  const inc = s.incident;
  if (!inc) return s.executions.length ? 'running' : 'idle';
  if (FINAL.has(inc.status)) return 'complete';
  return inc.status;
}

function renderChrome() {
  const { done, active } = flowStatus(state);
  const busy = state.meta.busy || ui.starting;
  const stepper = document.getElementById('stepper');
  const key = JSON.stringify([done, active, busy]);
  if (hashes.stepper !== key) {
    hashes.stepper = key;
    stepper.replaceChildren(...FLOW.flatMap(([id, label], i) => {
      const cls = done[id] ? 'is-done' : busy && i === active ? 'is-active' : '';
      const li = h('li', { class: `step ${cls}`, tabindex: 0, onclick: () => go(id), onkeydown: (e) => e.key === 'Enter' && go(id) }, h('span', { class: 'step-dot' }, done[id] ? '✓' : String(i + 1)), h('span', { class: 'lbl' }, label));
      return i < FLOW.length - 1 ? [li, h('li', { class: 'step-sep', 'aria-hidden': 'true' })] : [li];
    }));
  }
  const controls = document.getElementById('controls');
  const ckey = JSON.stringify([busy, ui.scenario, ui.pace, ui.approval, ui.follow, state.meta.canReset, Object.keys(state.meta.scenarios)]);
  if (hashes.controls !== ckey) {
    hashes.controls = ckey;
    const sel = (opts, val, on, label) => h('label', { class: 'field' }, h('span', null, label), h('select', { class: 'select', disabled: busy, onchange: (e) => on(e.target.value) }, Object.entries(opts).map(([k, v]) => h('option', { value: k, selected: k === val }, v))));
    controls.replaceChildren(
      sel(state.meta.scenarios, ui.scenario, (v) => ui.set({ scenario: v }, true), 'Scenario'),
      sel({ fast: 'Fast', normal: 'Normal', presenter: 'Presenter' }, ui.pace, (v) => ui.set({ pace: v }, true), 'Pace'),
      h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: ui.approval, disabled: busy, onchange: (e) => ui.set({ approval: e.target.checked }, true) }), 'Approve recovery manually'),
      h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: ui.follow, onchange: (e) => ui.set({ follow: e.target.checked }, true) }), 'Follow along'),
      h('button', { class: 'btn btn-ghost', id: 'reset-btn', disabled: !state.meta.canReset, onclick: actions.reset }, 'Reset'),
      h('button', { class: 'btn btn-primary', id: 'run-demo', disabled: busy, onclick: actions.run }, busy ? h('span', { class: 'spinner' }) : null, busy ? 'Running…' : 'Run Demo'),
    );
  }
  document.getElementById('foot-meta').textContent = state.meta.telemetry;
}

function go(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

function sectionData(id) {
  switch (id) {
    case 'connect': return [state.integrations, state.executions, state.incidents];
    case 'run': return [state.executions, state.lastRun, state.meta.telemetry];
    case 'tree': return [state.executions, state.lastRun, state.incident?.continuity, ui.treeExec];
    case 'fail': return [state.executions, state.lastRun, state.incident];
    case 'continuity': return [state.executions, state.lastRun, state.incident];
    case 'recover': return [state.incident, ui.payloadOpen];
    case 'verify': return [state.executions, state.lastRun, state.incident, state.ledger];
    case 'cost': return state.cost;
    case 'video': return state.meta.video;
    case 'acceptance': return state.acceptance;
    default: return null;
  }
}

function render() {
  if (!state) return;
  renderChrome();
  for (const [id, , fn] of SECTIONS) {
    const key = JSON.stringify(sectionData(id));
    if (hashes[id] === key) continue;
    hashes[id] = key;
    const sec = document.getElementById(id);
    try { sec.replaceChildren(fn(state, ui, actions)); } catch (e) { console.error(id, e); sec.replaceChildren(h('div', { class: 'empty' }, `This view failed to render: ${e.message}`)); }
  }
  const phase = phaseOf(state);
  document.body.dataset.phase = phase;
  if (phase !== lastPhase) {
    if (ui.follow && state.meta.busy) {
      const target = { running: 'run', failed: 'fail', detected: 'fail', diagnosed: 'continuity', awaiting_approval: 'recover', dispatching: 'recover', recovering: 'recover', complete: 'verify' }[phase];
      if (target) go(target);
    }
    lastPhase = phase;
  }
}

async function refresh() {
  try { state = await api('/api/state'); render(); } catch (e) { console.error(e); }
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.append(h('div', { class: 'nav-title' }, 'Sections'), ...SECTIONS.map(([id, label], i) => h('a', { href: `#${id}`, 'data-id': id }, h('i', null, String(i + 1).padStart(2, '0')), label)));
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) nav.querySelectorAll('a').forEach((a) => a.classList.toggle('is-current', a.dataset.id === en.target.id));
  }, { rootMargin: '-30% 0px -60% 0px' });
  SECTIONS.forEach(([id]) => io.observe(document.getElementById(id)));
}

buildNav();
refresh();
let pending = null;
const schedule = () => { if (!pending) pending = setTimeout(() => { pending = null; refresh(); }, 120); };
try {
  const es = new EventSource('/api/events');
  es.addEventListener('tick', schedule);
} catch { /* polling below covers it */ }

setInterval(() => { if (!state || state.meta.busy || document.visibilityState === 'visible') refresh(); }, 2500);
