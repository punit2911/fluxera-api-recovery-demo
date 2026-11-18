import { h, sectionHead } from '../dom.js';

const KIND = { pass: ['ok', 'Pass'], fail: ['err', 'Fail'], pending: ['muted', 'Pending'], 'n/a': ['info', 'Not applicable'] };

export function renderAcceptance(state) {
  const head = sectionHead({
    eyebrow: '10 · Evidence',
    title: 'Acceptance checks',
    lede: 'Computed from the recorded data of the latest run. Nothing here is hard-coded to pass.',
  });
  return h(
    'div',
    null,
    head,
    h(
      'div',
      { class: 'card' },
      state.acceptance.map((a) => {
        const [cls, text] = KIND[a.status] ?? ['muted', a.status];
        return h('div', { class: 'acc' }, h('div', { class: 'a' }, a.area), h('div', { class: 'o' }, a.observable), h('div', null, h('span', { class: `pill ${cls}` }, text)), h('div', { class: 'd' }, a.detail));
      }),
    ),
  );
}
