import { startApp } from '../test/helpers.js';

const t = await startApp();
let code = 0;
try {
  for (const scenario of ['resume', 'fallback', 'escalate']) {
    await t.post('/api/demo/reset');
    const s = await t.runScenario(scenario);
    const expected = scenario === 'escalate' ? 'escalated' : 'verified';
    const ok = s.incident.status === expected;
    if (!ok) code = 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${scenario.padEnd(9)} -> ${s.incident.status} (action: ${s.incident.decision.action}, executions: ${s.executions.length})`);
  }
} catch (err) {
  console.error('smoke failed:', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
