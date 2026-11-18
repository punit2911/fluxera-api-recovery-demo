import { empty, h, labelTag, sectionHead } from '../dom.js';

const CHAPTERS = [
  ['Connect', 'agents, workflows, tools, memory and six API categories with health'],
  ['Run', 'Run Demo starts the workflow and the execution tree appears'],
  ['Fail', 'the controlled temporary failure is recorded'],
  ['Analyze', 'diagnosis and work continuity'],
  ['Recover', 'safety checks, signed webhook, linked recovery run'],
  ['Verify and account', 'verified outcome and the cost-recovery sheet'],
];

export function renderVideo(state) {
  const head = sectionHead({
    eyebrow: '09 · Video',
    title: 'Walkthrough',
    lede: 'A recording of the same flow you can run above, from failure to verified recovery.',
    tags: [labelTag('Illustrative')],
  });
  const v = state.meta.video;
  let player;
  if (v.type === 'file') {
    player = h('div', { class: 'player' }, h('video', { controls: true, preload: 'auto', playsinline: true, poster: '/media/poster.jpg', src: v.src }));
  } else if (v.type === 'embed') {
    player = h('div', { class: 'player' }, h('iframe', { src: v.src, title: 'Walkthrough video', allowfullscreen: true, loading: 'lazy' }));
  } else {
    return h('div', null, head, empty('No walkthrough configured', 'Add public/media/walkthrough.mp4 or set VIDEO_URL.'));
  }
  return h(
    'div',
    { class: 'split', style: 'grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)' },
    h('div', { style: 'grid-column:1/-1' }, head),
    player,
    h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Chapters'), h('ol', { class: 'chapters' }, CHAPTERS.map(([t, d]) => h('li', null, h('span', null, h('b', null, t), d))))),
  );
}
