import { empty, h, idChip, labelTag, latestRunExecutions, modeTag, money, ms, sectionHead, statusPill } from '../dom.js';

const TYPE_LABEL = {
  workflow: 'WF',
  agent: 'AGENT',
  step: 'STEP',
  memory: 'MEM',
  tool: 'TOOL',
  api: 'API',
  checkpoint: 'CKPT',
};

function buildTree(nodes) {
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  return byParent;
}

function nodeRow(n) {
  const status = n.status === 'error' ? 'err' : n.status === 'running' ? 'run' : n.status === 'skipped' ? 'skipped' : '';
  const sub = [];
  if (n.type === 'api') sub.push(`${n.apiType ?? ''}${n.idempotencyKey ? ' · idempotent' : ''}`);
  if (n.type === 'step' && n.restoredFromCheckpoint) sub.push(`restored from ${n.restoredFromCheckpoint}, not re-executed`);
  if (n.type === 'checkpoint') sub.push(`recovery point after ${n.afterStep}`);
  if (n.fallbackFor) sub.push(`fallback for ${n.fallbackFor}`);

  const meta = [];
  if (n.type === 'api') {
    meta.push(modeTag(n.mode));
    meta.push(h('span', null, `attempt${n.attempts.length === 1 ? '' : 's'} `, h('b', null, String(n.attempts.length))));
    meta.push(h('span', null, ms(n.durationMs)));
    meta.push(h('span', { class: 'money' }, money(n.cost)));
    if (n.errorCategory) meta.push(h('span', { class: 'e' }, n.errorCategory));
  } else if (n.type === 'step' && n.status === 'skipped') {
    meta.push(h('span', { class: 'money muted' }, `was ${money(n.originalCost)}`));
  } else if (n.type !== 'checkpoint') {
    meta.push(h('span', null, n.status === 'running' ? 'running' : ms(n.durationMs)));
  }
  if (n.type !== 'checkpoint') meta.push(statusPill(n.status === 'error' ? 'failed' : n.status));

  return h(
    'div',
    { class: `tnode ${status}` },
    h('span', { class: `ttype ${n.type}` }, TYPE_LABEL[n.type] ?? n.type),
    h('div', { class: 'tname' }, h('b', { title: n.name }, n.name), sub.length ? h('small', null, sub.join(' · ')) : null),
    h('div', { class: 'tmeta' }, meta),
  );
}

function renderNodes(byParent, parentKey, ghosts) {
  const kids = byParent.get(parentKey) ?? [];
  if (!kids.length && !ghosts?.length) return null;
  return h(
    'ul',
    null,
    kids.map((n) =>
      h('li', null, nodeRow(n), n.type === 'agent' ? renderNodes(byParent, n.id, ghosts) : renderNodes(byParent, n.id)),
    ),
    parentKey !== 'root' && ghosts?.length ? ghosts : null,
  );
}

function ghostRows(incident, execution) {
  if (!incident?.continuity || incident.executionId !== execution.id) return [];
  return incident.continuity.steps
    .filter((s) => s.state === 'waiting' || s.state === 'safe_to_continue' || s.state === 'needs_review')
    .map((s) =>
      h(
        'li',
        null,
        h(
          'div',
          { class: 'tnode ghost' },
          h('span', { class: 'ttype step' }, 'STEP'),
          h(
            'div',
            { class: 'tname' },
            h('b', null, s.label),
            h('small', null, s.state === 'waiting' ? `not started, waiting on ${s.blockedBy.join(', ')}` : 'not started, independent of the failure'),
          ),
          h(
            'div',
            { class: 'tmeta' },
            h('span', { class: `pill ${s.state === 'waiting' ? 'warn' : 'info'}` }, s.state === 'waiting' ? 'Waiting' : 'Safe to continue'),
          ),
        ),
      ),
    );
}

export function renderTree(state, ui) {
  const { original, recovery } = latestRunExecutions(state);
  const head = sectionHead({
    eyebrow: '03 · Relationships',
    title: 'Component relationship view',
    lede: 'Which agent, memory, tool and API call belongs to which workflow step. This is one execution tree, not a flat API log.',
    tags: [labelTag('Observed')],
  });
  if (!original) {
    return h('div', null, head, empty('No execution tree yet', 'Run the demo to see workflow, agent, memory, tool and API nodes linked together.'));
  }

  const selected = ui.treeExec === 'recovery' && recovery ? recovery : original;
  const byParent = buildTree(selected.nodes);
  const ghosts = ghostRows(state.incident, selected);
  const root = (byParent.get('root') ?? [])[0];

  const seg = h(
    'div',
    { class: 'seg', role: 'tablist' },
    h('button', { class: ui.treeExec !== 'recovery' ? 'on' : '', onclick: () => ui.set({ treeExec: 'original' }) }, 'Original run'),
    h(
      'button',
      { class: ui.treeExec === 'recovery' ? 'on' : '', disabled: !recovery, onclick: () => ui.set({ treeExec: 'recovery' }) },
      'Recovery run',
    ),
  );

  return h(
    'div',
    null,
    head,
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'tree-head' },
        seg,
        h(
          'div',
          { class: 'tree-meta' },
          idChip(selected.id),
          statusPill(selected.status),
          h('span', null, ms(selected.durationMs)),
          h('span', { class: 'money' }, money(selected.totals.cost)),
          selected.recoveryOf ? h('span', null, 'recovers ', idChip(selected.recoveryOf)) : null,
          selected.resumedFrom ? h('span', { class: 'muted' }, `resumed from ${selected.resumedFrom.checkpointId}`) : null,
        ),
      ),
      root
        ? h('ul', { class: 'tree' }, h('li', null, nodeRow(root), renderNodes(byParent, root.id, ghosts)))
        : null,
    ),
  );
}
