// Records the walkthrough video by driving the real page in a browser.
// Needs Playwright (not a runtime dependency): npm i -D playwright
// Usage: node scripts/record-demo.js [baseUrl] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright')); }

const base = process.argv[2] || 'http://localhost:8080';
const out = path.resolve(process.argv[3] || 'tmp-video');
fs.mkdirSync(out, { recursive: true });

const CAPTIONS = {
  idle: 'Connect: agents, workflows, tools, memory and six API categories, each with a live health probe.',
  running: 'Run: Run Demo starts the support workflow. Every call lands in one execution tree.',
  detected: 'Fail: the notification gateway answers 503 once. The execution is marked failed.',
  diagnosed: 'Analyze: the failed step, its category, attempts and cost, and what it blocks.',
  dispatching: 'Recover: safety checks pass and a signed webhook is sent to the integration.',
  recovering: 'Recover: the integration resumes from checkpoint cp_s5 in a linked execution.',
  complete: 'Verify: the linked recovery succeeded. Completed steps were restored, not replayed.',
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto(base);
await page.locator('#connect .integ').nth(8).waitFor();
if (await page.locator('#reset-btn').isEnabled()) await page.click('#reset-btn');

await page.evaluate((captions) => {
  const bar = document.createElement('div');
  bar.id = 'cap';
  bar.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:980px;padding:12px 20px;border-radius:12px;background:rgba(5,7,11,.92);border:1px solid #2c3647;color:#eef1f6;font:500 17px/1.4 Inter,system-ui,sans-serif;z-index:9999;text-align:center;box-shadow:0 18px 40px -10px #000';
  document.body.append(bar);
  window.__cap = (t) => { bar.textContent = t; };
  window.__cap(captions.idle);
  let last = '';
  new MutationObserver(() => {
    const p = document.body.dataset.phase;
    if (p !== last && captions[p] && p !== 'idle') { last = p; window.__cap(captions[p]); }
  }).observe(document.body, { attributes: true, attributeFilter: ['data-phase'] });
}, CAPTIONS);

const scrollTo = async (id) => {
  await page.evaluate((i) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const section = document.getElementById(i);
    const topbar = document.getElementById('topbar');
    const offset = topbar?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - offset - 12, behavior: 'auto' });
  }, id);
  await page.waitForTimeout(500);
};
await scrollTo('connect');
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(out, 'poster.jpg'), type: 'jpeg', quality: 85 });
await page.selectOption('select >> nth=1', 'presenter');
await page.click('#run-demo');
await page.waitForFunction(() => document.body.dataset.phase === 'complete', null, { timeout: 120000 });
await page.waitForTimeout(5000);

const tour = [
  ['tree', 'Relationships: the agent, memory, tool and API calls, nested under the workflow step they belong to.'],
  ['continuity', 'Work continuity: completed, failed, waiting, unresolved and safe-to-continue work are separate.'],
  ['recover', 'Recovery: every safety check, the signed webhook request and the incident timeline.'],
  ['verify', 'Verified outcome: original and recovery executions side by side, with the sandbox ledger.'],
  ['cost', 'Cost sheet: Observed, Estimated and Verified values are labeled and never mixed.'],
];
for (const [id, text] of tour) {
  await scrollTo(id);
  await page.evaluate((t) => window.__cap(t), text);
  await page.waitForTimeout(5500);
}
await page.evaluate(() => window.__cap('Everything above was recorded from the running app. Estimates and sandbox values are labeled.'));
await page.waitForTimeout(3000);
const video = page.video();
await ctx.close();
await browser.close();
const target = path.join(out, 'walkthrough.webm');
if (fs.existsSync(target)) fs.unlinkSync(target);
await fs.promises.rename(await video.path(), target);
console.log(target);
