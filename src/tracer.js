import { AsyncLocalStorage } from 'node:async_hooks';
import { sleep } from './runtime.js';

// Error raised by API calls. Carries the information Fluxera needs to
// classify a failure: category, HTTP status, retryability and billed cost.
export class ApiError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'ApiError';
    this.category = opts.category ?? 'UNKNOWN';
    this.httpStatus = opts.httpStatus ?? null;
    this.retryable = opts.retryable ?? false;
    this.cost = opts.cost ?? 0;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.body = opts.body ?? null;
  }
}

const sumCost = (node) => node.attempts.reduce((acc, a) => acc + (a.cost || 0), 0);

// A small SDK-shaped tracer. The entry points mirror what the Fluxera Node
// SDK exposes (workflow, agent, memory, step, tool, track, checkpoint) and
// use AsyncLocalStorage so nested calls are linked into one execution tree.
export function createTracer(store) {
  const als = new AsyncLocalStorage();

  const here = () => {
    const ctx = als.getStore();
    if (!ctx) throw new Error('tracer call made outside of a workflow');
    return ctx;
  };

  const settle = (node, status, err) => {
    node.status = status;
    node.endedAt = Date.now();
    node.durationMs = node.endedAt - node.startedAt;
    if (err) {
      node.errorCategory = err.category ?? 'UNHANDLED';
      node.errorMessage = err.message;
    }
    store.touch();
  };

  async function component(type, name, opts, fn) {
    const ctx = here();
    const node = store.addNode(ctx.execution.id, {
      type,
      name,
      parentId: ctx.node.id,
      ...opts,
    });
    try {
      const out = await als.run({ execution: ctx.execution, node }, () => fn(node));
      settle(node, 'success');
      return out;
    } catch (err) {
      node.propagated = true;
      settle(node, 'error', err);
      throw err;
    }
  }

  async function workflow(name, opts, fn) {
    const execution = store.createExecution({
      workflowName: name,
      kind: opts.kind ?? 'original',
      runId: opts.runId ?? null,
      scenario: opts.scenario ?? null,
      recoveryOf: opts.recoveryOf ?? null,
      plan: opts.plan ?? [],
      action: opts.action ?? null,
      resumedFrom: opts.resumedFrom ?? null,
      options: opts.options ?? {},
    });
    const root = store.addNode(execution.id, { type: 'workflow', name, parentId: null });
    try {
      await als.run({ execution, node: root }, () => fn(execution));
      settle(root, 'success');
      store.finishExecution(execution, 'success');
    } catch (err) {
      root.propagated = true;
      settle(root, 'error', err);
      store.finishExecution(execution, 'failed', err);
    }
    return execution;
  }

  // API leaf with attempt tracking. attemptFn receives { attempt } and must
  // resolve to { data, cost, httpStatus } or throw an ApiError.
  async function track(spec, attemptFn) {
    const ctx = here();
    const node = store.addNode(ctx.execution.id, {
      type: 'api',
      name: spec.name,
      parentId: ctx.node.id,
      integration: spec.integration,
      apiCategory: spec.category,
      apiType: spec.apiType,
      mode: spec.mode,
      idempotencyKey: spec.idempotencyKey ?? null,
      maxAttempts: spec.maxAttempts ?? 1,
    });

    for (let n = 1; n <= node.maxAttempts; n += 1) {
      const attempt = {
        n,
        status: 'running',
        startedAt: Date.now(),
        durationMs: null,
        httpStatus: null,
        errorCategory: null,
        cost: 0,
      };
      node.attempts.push(attempt);
      store.touch();
      try {
        const res = await als.run({ execution: ctx.execution, node }, () => attemptFn({ attempt: n }));
        attempt.status = 'success';
        attempt.httpStatus = res.httpStatus ?? 200;
        attempt.cost = res.cost ?? 0;
        attempt.durationMs = Date.now() - attempt.startedAt;
        node.cost = sumCost(node);
        settle(node, 'success');
        return res;
      } catch (err) {
        attempt.status = 'error';
        attempt.httpStatus = err.httpStatus ?? null;
        attempt.errorCategory = err.category ?? 'UNKNOWN';
        attempt.message = err.message;
        attempt.cost = err.cost ?? 0;
        attempt.durationMs = Date.now() - attempt.startedAt;
        node.cost = sumCost(node);
        const giveUp = n === node.maxAttempts || !err.retryable;
        if (giveUp) {
          settle(node, 'error', err);
          throw err;
        }
        store.touch();
        await sleep((spec.backoffMs ?? 500) * n);
      }
    }
    return undefined;
  }

  function checkpoint(id, state, meta = {}) {
    const ctx = here();
    const cp = store.saveCheckpoint(ctx.execution.id, {
      id,
      afterStep: meta.afterStep ?? null,
      state: structuredClone(state),
    });
    const node = store.addNode(ctx.execution.id, {
      type: 'checkpoint',
      name: id,
      parentId: ctx.node.id,
      status: 'success',
      afterStep: meta.afterStep ?? null,
    });
    node.endedAt = node.startedAt;
    node.durationMs = 0;
    store.touch();
    return cp;
  }

  // Marks a step as restored from a checkpoint instead of being executed again.
  function restored(name, info) {
    const ctx = here();
    const node = store.addNode(ctx.execution.id, {
      type: 'step',
      name,
      parentId: ctx.node.id,
      status: 'skipped',
      stepId: info.stepId,
      restoredFromCheckpoint: info.checkpointId,
      originalNodeId: info.originalNodeId ?? null,
      originalCost: info.originalCost ?? 0,
      originalDurationMs: info.originalDurationMs ?? 0,
      integration: info.integration,
    });
    node.endedAt = node.startedAt;
    node.durationMs = 0;
    store.touch();
    return node;
  }

  return {
    workflow,
    agent: (name, opts, fn) => component('agent', name, opts ?? {}, fn),
    memory: (name, opts, fn) => component('memory', name, opts ?? {}, fn),
    step: (name, opts, fn) => component('step', name, opts ?? {}, fn),
    tool: (name, opts, fn) => component('tool', name, opts ?? {}, fn),
    track,
    checkpoint,
    restored,
  };
}
