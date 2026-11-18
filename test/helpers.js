import { createApp } from '../src/app.js';

export async function startApp(overrides = {}) {
  const app = createApp({ speed: 0, port: 0, host: '127.0.0.1', ...overrides });
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const call = async (path, opts = {}) => {
    const res = await fetch(base + path, opts);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, headers: res.headers };
  };
  const post = (path, data) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data ?? {}) });
  const final = new Set(['verified', 'recovery_failed', 'escalated', 'recovery_not_observed']);
  const waitFinal = async (timeoutMs = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const { body } = await call('/api/state');
      if (body.incident && final.has(body.incident.status)) return body;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out, status ${body.incident?.status}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const runScenario = async (scenario, extra = {}) => {
    const r = await post('/api/demo/run', { scenario, ...extra });
    if (r.status !== 202) throw new Error(`run failed ${r.status} ${JSON.stringify(r.body)}`);
    return waitFinal();
  };
  return { app, base, call, post, waitFinal, runScenario, close: () => app.close() };
}
