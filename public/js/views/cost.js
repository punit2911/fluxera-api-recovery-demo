import { empty, h, idChip, labelTag, money, sectionHead } from '../dom.js';

const pendingCell = (r) => (r.value === null || r.value === undefined ? h('span', { class: 'pending-val' }, 'Pending') : h('span', { class: 'money' }, money(r.value)));

function bar(row, max) {
  const w = (v) => (max ? Math.max((v / max) * 100, v > 0 ? 1.5 : 0) : 0);
  const okPart = Math.max(row.original - row.failed, 0);
  return h(
    'div',
    { class: 'costbar', title: 'blue: succeeded, red: failed calls, violet: recovery' },
    h('i', { class: 'a', style: `width:${w(okPart)}%` }),
    h('i', { class: 'f', style: `width:${w(row.failed)}%` }),
    h('i', { class: 'r', style: `width:${w(row.recovery)}%` }),
  );
}

export function renderCost(state) {
  const head = sectionHead({
    eyebrow: '08 · Account',
    title: 'Unified cost-recovery sheet',
    lede: 'Every number carries a label. Observed values are recorded leaf costs, Estimated values are projections, Verified savings exist only after a successful linked recovery.',
    tags: [labelTag('Observed'), labelTag('Estimated'), labelTag('Verified')],
  });
  const c = state.cost;
  if (!c) return h('div', null, head, empty('No cost data yet', 'The sheet is built from the recorded execution once the demo has run.'));

  const maxCat = Math.max(...c.byCategory.map((r) => r.original + r.recovery), 0);
  const maxInt = Math.max(...c.byIntegration.map((r) => r.original + r.recovery), 0);

  return h(
    'div',
    { class: 'stack fade-in' },
    head,
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, 'Cost metrics', h('span', null, idChip(c.executionId), c.recoveryExecutionId ? [' + ', idChip(c.recoveryExecutionId)] : null)),
      h(
        'div',
        { class: 'tbl-wrap' },
        h(
          'table',
          { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Metric'), h('th', { class: 'r' }, 'Value'), h('th', null, 'Label'), h('th', null, 'Definition'))),
          h(
            'tbody',
            null,
            c.rows.map((r) =>
              h('tr', null, h('td', null, r.metric), h('td', { class: 'r' }, pendingCell(r)), h('td', null, labelTag(r.label)), h('td', { class: 'def' }, r.definition)),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-title' }, 'By integration area', labelTag('Observed')),
        h(
          'div',
          { class: 'tbl-wrap' },
          h(
            'table',
            { class: 't' },
            h('thead', null, h('tr', null, h('th', null, 'Area'), h('th', null, 'Spend'), h('th', { class: 'r' }, 'Original'), h('th', { class: 'r' }, 'Failed'), h('th', { class: 'r' }, 'Recovery'))),
            h(
              'tbody',
              null,
              c.byCategory.map((r) =>
                h('tr', null, h('td', null, r.label), h('td', { style: 'min-width:110px' }, bar(r, maxCat)), h('td', { class: 'r money' }, money(r.original)), h('td', { class: 'r money' }, money(r.failed)), h('td', { class: 'r money' }, money(r.recovery))),
              ),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-title' }, 'By model, API, tool and memory', labelTag('Observed')),
        h(
          'div',
          null,
          c.byComponent.map((r) => h('div', { class: 'kvline' }, h('span', null, r.label), h('span', { class: 'money' }, `${money(r.original)} → ${money(r.recovery)}`))),
          c.modelCost ? h('div', { class: 'kvline' }, h('span', null, 'Model call'), h('span', { class: 'money' }, `${c.modelCost.name} ${money(c.modelCost.cost)}`)) : null,
          h('div', { class: 'kvline' }, h('span', null, 'Workflow'), h('span', { class: 'mono' }, c.byWorkflow.workflow)),
          h('div', { class: 'kvline' }, h('span', null, 'Workflow cost, original / recovery'), h('span', { class: 'money' }, `${money(c.byWorkflow.original)} / ${money(c.byWorkflow.recovery)}`)),
          h('div', { class: 'kvline' }, h('span', null, 'Restored, not re-executed'), h('span', { class: 'money' }, money(c.byWorkflow.restoredNotRepeated))),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, 'By integration', labelTag('Observed')),
      h(
        'div',
        { class: 'tbl-wrap' },
        h(
          'table',
          { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Integration'), h('th', null, 'Type'), h('th', null, 'Spend'), h('th', { class: 'r' }, 'Calls'), h('th', { class: 'r' }, 'Total'))),
          h(
            'tbody',
            null,
            c.byIntegration.map((r) =>
              h('tr', null, h('td', null, r.name), h('td', { class: 'muted' }, r.type), h('td', { style: 'min-width:110px' }, bar(r, maxInt)), h('td', { class: 'r' }, String(r.calls)), h('td', { class: 'r money' }, money(r.original + r.recovery))),
            ),
          ),
        ),
      ),
    ),
    h('div', { class: 'assump' }, labelTag('Estimated'), h('span', null, `Monthly projections assume 50 similar incidents per month. This is an assumption, not a measurement. ${c.note}`)),
  );
}
