import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createTracer } from './tracer.js';
import { Sandbox, createStubHandler } from './stubs.js';
import { createIntegration, SCENARIOS } from './integration.js';
import { createControlPlane } from './controlPlane.js';
import { HealthMonitor } from './integrations.js';
import { buildState } from './view.js';
import { runtime } from './runtime.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

const PACE = { fast: 0.35, normal: 1, presenter: 1.8 };

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "media-src 'self' https:",
    'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com',
    "connect-src 'self'",
  ].join('; '),
};

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

export function createApp(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  runtime.speed = config.speed;

  const store = new Store();
  const tracer = createTracer(store);
  const sandbox = new Sandbox({ notifyFailCount: config.notifyFailCount });
  const health = new HealthMonitor();
  const stubs = createStubHandler(sandbox);
  const runs = [];
  const state = { origin: null, runSeq: 0 };

  const getOrigin = () => state.origin;
  const getWebhookUrl = () => config.webhookUrl || (state.origin ? `${state.origin}/integration/recovery-webhook` : null);

  const integration = createIntegration({ store, tracer, sandbox, getOrigin, config });
  const controlPlane = createControlPlane({
    store,
    sandbox,
    getWebhookUrl,
    secret: config.webhookSecret,
    recoveryTimeoutMs: config.recoveryTimeoutMs ?? 60000,
  });

  const ctx = { store, sandbox, health, config, runs, runtime, controlPlane };

  // --- server-sent events ---
  const clients = new Set();
  let pending = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const msg = `event: tick\ndata: ${JSON.stringify({ rev: store.revision })}\n\n`;
      for (const c of clients) c.write(msg);
    }, 80);
  };
  store.on('change', broadcast);
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': keep-alive\n\n');
  }, 15000);
  heartbeat.unref?.();

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(config.publicDir, rel));
    if (!file.startsWith(config.publicDir)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] ?? 'application/octet-stream';
      const headers = {
        'content-type': type,
        'accept-ranges': 'bytes',
        'cache-control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600',
        ...SECURITY_HEADERS,
      };
      const range = req.headers.range;
      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [s, e] = range.replace('bytes=', '').split('-');
        const start = s === '' ? Math.max(0, stat.size - Number(e)) : Number(s);
        const end = s === '' || e === '' ? stat.size - 1 : Math.min(Number(e), stat.size - 1);
        if (start > end || start >= stat.size) {
          res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
          return;
        }
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': stat.size });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const { pathname } = url;
    try {
      if (pathname === '/healthz') return json(res, 200, { ok: true });

      if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, buildState(ctx));

      if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write(`retry: 2000\nevent: tick\ndata: ${JSON.stringify({ rev: store.revision })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return undefined;
      }

      if (pathname === '/api/demo/run' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const scenario = body.scenario ?? 'resume';
        if (!(scenario in SCENARIOS)) return json(res, 400, { error: 'unknown scenario' });
        if (controlPlane.isBusy()) return json(res, 409, { error: 'A run is already in progress.' });
        runtime.speed = (PACE[body.pace] ?? 1) * (config.speed === 0 ? 0 : config.speed);
        const runId = `run-${String(++state.runSeq).padStart(3, '0')}`;
        const autoRecover = body.autoRecover !== false;
        const run = { runId, scenario, autoRecover, startedAt: Date.now() };
        runs.push(run);
        integration.startRun({ runId, scenario, options: { autoRecover } }).catch(() => {});
        return json(res, 202, run);
      }

      if (pathname === '/api/demo/reset' && req.method === 'POST') {
        if (!controlPlane.canReset()) return json(res, 409, { error: 'A run is still in flight. Wait for it to finish.' });
        store.clear();
        sandbox.reset();
        integration.resetSeen();
        runs.length = 0;
        state.runSeq = 0;
        store.touch();
        return json(res, 200, { ok: true });
      }

      const approve = pathname.match(/^\/api\/incidents\/([\w-]+)\/approve$/);
      if (approve && req.method === 'POST') {
        const result = await controlPlane.dispatch(approve[1]);
        return json(res, result.ok ? 202 : 409, result);
      }

      if (pathname === '/integration/recovery-webhook' && req.method === 'POST') {
        const rawBody = await readBody(req);
        const out = await integration.handleWebhook({ headers: req.headers, rawBody });
        return json(res, out.status, out.body);
      }

      if (pathname.startsWith('/stub/')) {
        const raw = req.method === 'POST' ? await readBody(req) : '';
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = null;
        }
        if (await stubs(req, res, url, body)) return undefined;
      }

      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
      return json(res, 405, { error: 'method not allowed' });
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: 'internal error', detail: err.message });
      else res.end();
      return undefined;
    }
  }

  const server = http.createServer(handler);

  return {
    server,
    ctx,
    integration,
    controlPlane,
    store,
    sandbox,
    health,
    config,
    runs,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const actual = server.address().port;
          state.origin = `http://127.0.0.1:${actual}`;
          health.start(getOrigin, broadcast);
          resolve(actual);
        });
      });
    },
    close() {
      health.stop();
      clearInterval(heartbeat);
      controlPlane.detach();
      for (const c of clients) c.end();
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
