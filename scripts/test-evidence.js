import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const run = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
const started = new Date();
const tests = run(['--test', '--test-concurrency=1', '--test-reporter=spec', ...fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`)]);
const smoke = run(['scripts/smoke.js']);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').trim();

const out = `# Test evidence

Generated ${started.toISOString()} on Node ${process.version}.
Command: \`npm run test:evidence\`

## Automated tests

\`\`\`
${strip(tests.stdout + tests.stderr)}
\`\`\`

## Smoke run (all three scenarios, end to end over HTTP)

\`\`\`
${strip(smoke.stdout + smoke.stderr)}
\`\`\`

Exit codes: tests ${tests.status}, smoke ${smoke.status}.
`;
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/TEST_EVIDENCE.md', out);
console.log(out);
process.exit(tests.status || smoke.status ? 1 : 0);
