import { empty, h, idChip, labelTag, latestRunExecutions, money, sectionHead } from '../dom.js';

const STATE_TEXT = {
  completed: 'Completed',
  failed: 'Failed',
  waiting: 'Waiting',
  safe_to_continue: 'Safe to continue',
  needs_review: 'Needs review',
};

function stepCard(s) {
  return h(
    'div',
    { class: `pstep ${s.state}` },
    h('div', { class: 'sid' }, s.id),
    h('div', { class: 'slabel' }, s.label),
    h('div', { class: 'sstate' }, STATE_TEXT[s.state] ?? s.state),
    h(
      'div',
      { class: 'flags' },
      s.sideEffect ? h('span', { class: 'flag' }, 'side effect') : null,
      s.idempotent ? h('span', { class: 'flag' }, 'idempotent') : h('span', { class: 'flag', style: 'color:var(--err);border-color:rgba(255,92,112,.4)' }, 'not idempotent'),
      s.irreversible ? h('span', { class: 'flag', style: 'color:var(--err);border-color:rgba(255,92,112,.4)' }, 'irreversible') : null,
    ),
  );
}

function afterRecovery(inc, recovery) {
  const plan = recovery.plan;
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-title' }, 'After recovery', idChip(recovery.id)),
    h(
      'div',
      { class: 'pipeline' },
      plan.map((step) => {
        const node = recovery.nodes.find((n) => n.type === 'step' && n.stepId === step.id);
        let cls = 'notrun';
        let text = 'Not run';
        if (node?.status === 'skipped') {
          cls = 'restored';
          text = 'Restored';
        } else if (node?.status === 'success') {
          cls = 'completed';
          text = 'Completed now';
        } else if (node?.status === 'error') {
          cls = 'failed';
          text = 'Failed';
        } else if (node?.status === 'running') {
          cls = 'safe_to_continue';
          text = 'Running';
        }
        return h(
          'div',
          { class: `pstep ${cls}` },
          h('div', { class: 'sid' }, step.id),
          h('div', { class: 'slabel' }, step.label),
          h('div', { class: 'sstate' }, text),
        );
      }),
    ),
  );
}

function bucket(cls, title, items, render) {
  return h(
    'div',
    { class: `card bucket ${cls}` },
    h('h4', null, title, h('em', null, String(items.length))),
    items.length ? h('ul', null, items.map(render)) : h('span', { class: 'muted' }, 'None'),
  );
}

export function renderContinuity(state) {
  const head = sectionHead({
    eyebrow: '05 · Analyze',
    title: 'Work continuity',
    lede: 'The state of the whole execution, not only the failed request: what finished, what failed, what is blocked, what is still unresolved and what can safely carry on.',
    tags: [labelTag('Observed'), labelTag('Illustrative')],
  });
  const inc = state.incident;
  if (!inc || !inc.continuity) {
    return h('div', null, head, empty(inc ? 'Analyzing workflow state…' : 'No continuity analysis yet', 'The analysis appears as soon as a failure is diagnosed.'));
  }
  const c = inc.continuity;
  const byId = new Map(c.steps.map((s) => [s.id, s]));
  const { recovery } = latestRunExecutions(state);
  const item = (id) => {
    const s = byId.get(id);
    return h('li', null, h('b', null, s.id), s.label, s.cost ? h('small', null, `${s.integration} · ${money(s.cost)}`) : h('small', null, s.integration));
  };

  return h(
    'div',
    { class: 'stack fade-in' },
    head,
    h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Original execution', idChip(inc.executionId)), h('div', { class: 'pipeline' }, c.steps.map(stepCard))),
    h(
      'div',
      { class: 'buckets' },
      bucket('completed', 'Completed before the failure', c.buckets.completed, item),
      bucket('failed', 'Failed', c.buckets.failed, item),
      bucket('waiting', 'Waiting on the failure', c.buckets.waiting, (id) => {
        const s = byId.get(id);
        return h('li', null, h('b', null, s.id), s.label, h('small', null, `blocked by ${s.blockedBy.join(', ')}`));
      }),
      bucket('unresolved', 'Unresolved outcomes', c.buckets.unresolved, (u) => h('li', null, h('b', null, u.stepId), u.outcome, h('small', null, u.reason))),
      bucket('safe', 'Safe to continue', c.buckets.safeToContinue, (id) => {
        const s = byId.get(id);
        return h('li', null, h('b', null, s.id), s.label, h('small', null, 'independent of the failed step'));
      }),
    ),
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-title' }, 'Recovery point'),
        c.checkpoint
          ? h(
              'div',
              null,
              kv('Eligible checkpoint', h('span', { class: 'mono' }, c.checkpoint.id)),
              kv('Saved after step', c.checkpoint.afterStep),
              kv('Can the failed step be retried', c.canRetry ? 'Yes, it is idempotent and the error is transient' : 'No'),
              kv('Can the workflow resume', c.canResume ? 'Yes, from the checkpoint' : 'No, not automatically'),
              kv('Must not be replayed', c.doNotReplay.length ? c.doNotReplay.join(', ') : 'none'),
            )
          : h('p', { class: 'muted' }, 'No checkpoint was recorded.'),
      ),
      h('div', { class: 'sentence' }, h('b', null, 'Summary. '), c.summary),
    ),
    recovery ? afterRecovery(inc, recovery) : null,
  );
}

const kv = (k, v) => h('div', { class: 'kvline' }, h('span', null, k), h('span', null, v));
