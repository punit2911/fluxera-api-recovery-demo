import { empty, h, idChip, labelTag, modeTag, money, ms, sectionHead, statusPill } from '../dom.js';

const fact = (label, value) => h('div', null, h('dt', null, label), h('dd', null, value));

export function renderDiagnosis(state) {
  const head = sectionHead({
    eyebrow: '04 · Fail',
    title: 'Failure diagnosis',
    lede: 'The failed API step, its category and attempts, what it cost, and what it blocks. All values are read from the recorded execution.',
    tags: [labelTag('Observed')],
  });
  const inc = state.incident;
  const latest = state.executions.filter((e) => e.runId === state.lastRun?.runId && e.kind === 'original')[0];

  if (!inc) {
    if (latest && latest.status === 'success') {
      return h('div', null, head, empty('No failure on this run', `Execution ${latest.id} completed successfully.`));
    }
    return h(
      'div',
      null,
      head,
      empty(
        latest ? 'Waiting for a failure' : 'No failure yet',
        latest ? 'The workflow is still running.' : 'The controlled failure appears here after Run Demo.',
      ),
    );
  }

  const d = inc.diagnosis;
  if (!d) {
    return h(
      'div',
      null,
      head,
      h(
        'div',
        { class: 'alert' },
        h('div', { class: 'ico' }, '!'),
        h('div', null, h('h3', null, 'Failure detected'), h('p', null, `Execution ${inc.executionId} ended failed. Diagnosing the execution tree…`)),
      ),
    );
  }

  return h(
    'div',
    { class: 'stack fade-in' },
    head,
    h(
      'div',
      { class: 'alert' },
      h('div', { class: 'ico' }, '!'),
      h(
        'div',
        null,
        h('h3', null, `${d.stepId} · ${d.stepLabel} failed`),
        h('p', null, `${d.component.integrationName} returned ${d.error.category} (HTTP ${d.error.httpStatus ?? 'n/a'}) after ${d.attemptCount} attempt${d.attemptCount === 1 ? '' : 's'}.`),
      ),
    ),
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-title' }, 'Failed component'),
        h(
          'dl',
          { class: 'facts' },
          fact('API call', h('span', { class: 'mono' }, d.component.name)),
          fact('Integration', `${d.component.integrationName}`),
          fact('Type', `${d.component.apiType}`),
          fact('Mode', modeTag(d.component.mode)),
          fact('Tool', d.component.toolName ? h('span', { class: 'mono' }, d.component.toolName) : '—'),
          fact('Workflow step', `${d.stepId} · ${d.stepLabel}`),
          fact('Error category', h('span', { class: 'pill err' }, d.error.category)),
          fact('HTTP status', String(d.error.httpStatus ?? '—')),
          fact('Attempts', String(d.attemptCount)),
          fact('Elapsed (incl. backoff)', ms(d.latencyMs)),
          fact('Failed-call cost', h('span', { class: 'money' }, money(d.cost.failedCalls))),
          fact('Retry waste', h('span', { class: 'money' }, money(d.cost.retryWaste))),
          fact('Idempotency key', d.component.idempotencyKey ? h('span', { class: 'mono' }, d.component.idempotencyKey) : 'none'),
          fact('Execution', idChip(inc.executionId)),
        ),
      ),
      h(
        'div',
        { class: 'card prose' },
        h('div', { class: 'card-title' }, 'What the data says'),
        h('h4', null, 'Cause'),
        h('p', null, d.cause),
        h('h4', null, 'Message from the API'),
        h('p', { class: 'mono', style: 'font-size:12.5px' }, d.error.message),
        h('h4', null, 'Impact'),
        h('p', null, d.impact),
        h('h4', null, 'Recovery guidance'),
        h('p', null, d.guidance),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, 'Attempts on the failed call', labelTag('Observed')),
      h(
        'div',
        { class: 'tbl-wrap' },
        h(
          'table',
          { class: 't' },
          h('thead', null, h('tr', null, ['Attempt', 'Status', 'HTTP', 'Category', 'Latency', 'Cost'].map((c, i) => h('th', { class: i >= 4 ? 'r' : '' }, c)))),
          h(
            'tbody',
            null,
            d.attempts.map((a) =>
              h(
                'tr',
                null,
                h('td', { class: 'mono' }, `#${a.n}`),
                h('td', null, statusPill(a.status === 'error' ? 'failed' : a.status)),
                h('td', { class: 'mono' }, String(a.httpStatus ?? '—')),
                h('td', { class: 'mono' }, a.errorCategory ?? '—'),
                h('td', { class: 'r' }, ms(a.durationMs)),
                h('td', { class: 'r money' }, money(a.cost)),
              ),
            ),
          ),
        ),
      ),
      h('div', { class: 'card-title', style: 'margin-top:16px' }, 'Evidence'),
      h('ul', { class: 'evidence' }, d.evidence.map((e) => h('li', null, e))),
    ),
  );
}
