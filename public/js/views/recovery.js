import { clock, empty, h, labelTag, offset, sectionHead } from '../dom.js';

const ACTION_TEXT = {
  resume_from_checkpoint: 'Resume from checkpoint',
  fallback: 'Fallback to approved tool',
  retry: 'Retry',
  escalate: 'Escalate to a person',
};

const GOOD = new Set(['verified', 'accepted']);
const BAD = new Set(['escalated', 'recovery_failed', 'recovery_not_observed']);

function highlight(json) {
  const text = JSON.stringify(json, null, 2);
  const parts = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b\d+(?:\.\d+)?\b)|(\bnull\b|\btrue\b|\bfalse\b)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] && m[2]) parts.push(h('span', { class: 'k' }, m[1]), m[2]);
    else if (m[1]) parts.push(h('span', { class: 's' }, m[1]));
    else parts.push(h('span', { class: 'n' }, m[0]));
    last = re.lastIndex;
  }
  parts.push(text.slice(last));
  return parts;
}

function checkList(checks) {
  return h(
    'ul',
    { class: 'checks' },
    checks.map((c) =>
      h(
        'li',
        null,
        h('span', { class: `ck ${c.pass ? 'pass' : 'fail'}` }, c.pass ? '✓' : '✕'),
        h('div', null, h('b', null, c.label), h('small', null, c.detail)),
      ),
    ),
  );
}

export function renderRecovery(state, ui, actions) {
  const head = sectionHead({
    eyebrow: '06 · Recover',
    title: 'Recovery action',
    lede: 'Fluxera decides whether recovery is safe, then dispatches the configured recovery webhook. The integration owns the retry or resume. Fluxera records the action and observes the result.',
    tags: [labelTag('Observed')],
  });
  const inc = state.incident;
  if (!inc || !inc.decision) {
    return h('div', null, head, empty(inc ? 'Deciding on a recovery action…' : 'No recovery action yet', 'The decision and its safety checks appear after the failure is analyzed.'));
  }
  const d = inc.decision;
  const escalated = d.action === 'escalate';
  const action = inc.actions.find((a) => a.type !== 'escalate') ?? null;

  const approve =
    inc.status === 'awaiting_approval'
      ? h(
          'div',
          { class: 'card', style: 'border-color:rgba(141,155,255,.45)' },
          h('div', { class: 'card-title' }, 'Approval required'),
          h('p', { class: 'muted', style: 'margin-bottom:12px' }, 'Recovery was held for a person. Nothing has been dispatched yet.'),
          h('button', { class: 'btn btn-primary', onclick: () => actions.approve(inc.id) }, 'Approve and dispatch recovery'),
        )
      : null;

  const timeline = h(
    'ol',
    { class: 'vtl' },
    inc.timeline.map((t) =>
      h(
        'li',
        { class: GOOD.has(t.event) ? 'good' : BAD.has(t.event) ? 'bad' : '' },
        h('b', null, t.event.replace(/_/g, ' ')),
        h('time', null, `${clock(t.at)} ${offset(t.at, inc.detectedAt)}`),
        h('p', null, t.detail),
      ),
    ),
  );

  const webhook = action
    ? h(
        'details',
        { class: 'fold', open: ui.payloadOpen, ontoggle: (e) => ui.set({ payloadOpen: e.target.open }, true) },
        h('summary', null, 'Recovery webhook request and response'),
        h(
          'div',
          null,
          h('div', { class: 'kvline' }, h('span', null, 'POST'), h('span', { class: 'mono' }, action.webhook.url)),
          h('div', { class: 'kvline' }, h('span', null, 'x-fluxera-signature'), h('span', { class: 'mono' }, action.webhook.signaturePreview)),
          h('div', { class: 'kvline' }, h('span', null, 'Response'), h('span', { class: 'mono' }, String(action.webhook.status ?? action.webhook.error ?? 'pending'))),
          h('pre', { class: 'code', style: 'margin-top:10px' }, highlight(action.payload)),
        ),
      )
    : null;

  return h(
    'div',
    { class: 'fade-in' },
    head,
    h(
      'div',
      { class: `decision ${escalated ? 'escalate' : ''}` },
      h(
        'div',
        null,
        h('div', { class: 'tags-row', style: 'margin-bottom:6px' }, h('span', { class: `tag ${escalated ? 'estimated' : 'verified'}` }, escalated ? 'Not safe to automate' : 'Safe and supported')),
        h('h3', null, ACTION_TEXT[d.action] ?? d.action),
        h('p', null, d.rationale),
      ),
    ),
    h(
      'div',
      { class: 'split' },
      h('div', { class: 'stack' }, h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Safety checks'), checkList(d.checks)), approve),
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Incident timeline', h('span', { class: 'mono' }, inc.id)), timeline),
        webhook,
        inc.escalation
          ? h(
              'div',
              { class: 'card', style: 'border-color:rgba(255,92,112,.4)' },
              h('div', { class: 'card-title' }, 'Escalation record'),
              h('div', { class: 'kvline' }, h('span', null, 'Ticket'), h('span', { class: 'mono' }, inc.escalation.id)),
              h('div', { class: 'kvline' }, h('span', null, 'Owner'), h('span', null, inc.escalation.owner)),
              h('div', { class: 'kvline' }, h('span', null, 'Replayed work'), h('span', null, 'None. Completed steps were left untouched.')),
            )
          : null,
      ),
    ),
  );
}
