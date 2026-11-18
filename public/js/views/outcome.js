import { clock, empty, h, idChip, labelTag, latestRunExecutions, money, ms, sectionHead, statusPill } from '../dom.js';

function verdict(inc) {
  if (!inc) return { cls: 'idle', icon: '·', title: 'Waiting for a run', text: 'The final outcome appears after the failure has been handled.' };
  switch (inc.status) {
    case 'verified':
      return {
        cls: 'verified',
        icon: '✓',
        title: 'Recovery verified',
        text: `The linked recovery execution ${inc.recoveryExecutionId} finished successfully and the previously failed step now has a successful API result. Verified at ${clock(inc.verification?.verifiedAt)}.`,
      };
    case 'recovery_failed':
      return { cls: 'failed', icon: '✕', title: 'Recovery not verified', text: 'The recovery execution did not meet every verification check, so nothing is reported as recovered.' };
    case 'recovery_not_observed':
      return { cls: 'failed', icon: '?', title: 'Recovery not observed', text: 'No successful linked recovery execution was recorded in time, so nothing is reported as recovered.' };
    case 'escalated':
      return {
        cls: 'escalated',
        icon: '!',
        title: 'Escalated, not recovered',
        text: `Recovery was not safe to automate. Fluxera did not replay anything and raised ${inc.escalation?.id}. No savings are claimed.`,
      };
    case 'awaiting_approval':
      return { cls: 'progress', icon: '…', title: 'Waiting for approval', text: 'The recovery action is ready and held for a person to approve.' };
    default:
      return { cls: 'progress', icon: '…', title: 'Recovery in progress', text: 'Verification happens only after a successful linked recovery result is recorded.' };
  }
}

function execCard(title, ex, extra) {
  return h(
    'div',
    { class: 'card ex-card' },
    h('h4', null, title, ex ? statusPill(ex.status) : h('span', { class: 'pill muted' }, 'Not started')),
    ex
      ? h(
          'div',
          null,
          kv('Execution', idChip(ex.id)),
          kv('Duration', ms(ex.durationMs)),
          kv('API attempts', `${ex.totals.attempts}${ex.totals.failedAttempts ? ` (${ex.totals.failedAttempts} failed)` : ''}`),
          kv('Cost', h('span', { class: 'money' }, money(ex.totals.cost))),
          extra,
        )
      : h('p', { class: 'muted' }, 'No recovery execution exists for this incident.'),
  );
}

const kv = (k, v) => h('div', { class: 'kvline' }, h('span', null, k), h('span', null, v));

function ledger(l) {
  const cell = (value, label, good) => h('div', { class: `cell ${good ? 'good' : ''}` }, h('b', null, String(value)), h('span', null, label));
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-title' }, 'Sandbox side-effect ledger', labelTag('Sandbox')),
    h(
      'div',
      { class: 'ledger' },
      cell(l.crmCases.length, 'CRM cases opened', l.crmCases.length <= 1),
      cell(l.notifications.length, 'Notifications in sandbox sink'),
      cell(l.emails.length, 'Fallback emails in sandbox sink'),
      cell(l.analyticsEvents, 'Analytics events'),
      cell(l.auditEntries, 'Audit entries'),
      cell(`${l.refunds.attempted} / ${l.refunds.unknownOutcome}`, 'Refund attempts / unknown outcome'),
      cell(l.duplicateSideEffects, 'Duplicate side effects', l.duplicateSideEffects === 0),
      cell(l.liveOperations + l.refunds.fundsMoved, 'Live operations or funds moved', true),
    ),
    h('p', { class: 'muted', style: 'margin-top:12px;font-size:12.5px' }, 'Messages land in an in-memory sandbox outbox. Nothing is delivered to a customer and no money moves.'),
  );
}

export function renderOutcome(state) {
  const head = sectionHead({
    eyebrow: '07 · Verify',
    title: 'Verified outcome',
    lede: 'Recovery counts as verified only when a linked recovery execution succeeds and every check below passes. The UI never reports success it has not recorded.',
    tags: [labelTag('Verified')],
  });
  const inc = state.incident;
  const { original, recovery } = latestRunExecutions(state);
  const v = verdict(inc);
  const resumed = recovery?.nodes.filter((n) => n.status === 'skipped').length ?? 0;
  const executed = recovery?.nodes.filter((n) => n.type === 'step' && n.status !== 'skipped').length ?? 0;

  return h(
    'div',
    { class: 'fade-in' },
    head,
    h('div', { class: `verdict ${v.cls}` }, h('div', { class: 'badge' }, v.icon), h('div', null, h('h3', null, v.title), h('p', null, v.text))),
    inc
      ? h(
          'div',
          null,
          h(
            'div',
            { class: 'compare' },
            execCard('Original execution', original),
            h('div', { class: 'arrow' }, '→'),
            execCard(
              'Linked recovery execution',
              recovery,
              recovery
                ? h(
                    'div',
                    null,
                    kv('Recovers', idChip(recovery.recoveryOf)),
                    kv('Resumed from', recovery.resumedFrom?.checkpointId ?? 'start'),
                    kv('Restored / executed steps', `${resumed} / ${executed}`),
                    recovery.action?.type === 'fallback' ? kv('Fallback used', recovery.action.fallbackIntegration) : null,
                  )
                : null,
            ),
          ),
          h(
            'div',
            { class: 'split' },
            h(
              'div',
              { class: 'card' },
              h('div', { class: 'card-title' }, 'Verification checks'),
              inc.verification
                ? h(
                    'ul',
                    { class: 'checks' },
                    inc.verification.checks.map((c) =>
                      h('li', null, h('span', { class: `ck ${c.pass ? 'pass' : 'fail'}` }, c.pass ? '✓' : '✕'), h('div', null, h('b', null, c.label), h('small', null, c.detail))),
                    ),
                  )
                : h(
                    'ul',
                    { class: 'checks' },
                    ['Recovery execution is linked to the original', 'Recovery execution finished successfully', 'The previously failed step now has a successful API result', 'No completed work was replayed', 'No duplicate side effects in the sandbox ledger'].map(
                      (label) => h('li', null, h('span', { class: 'ck pend' }, '·'), h('div', null, h('b', null, label), h('small', null, inc.status === 'escalated' ? 'Not applicable, no recovery ran' : 'Pending'))),
                    ),
                  ),
            ),
            ledger(state.ledger),
          ),
        )
      : empty('No outcome to show', 'Run the demo to see the original and recovery executions side by side.'),
  );
}
