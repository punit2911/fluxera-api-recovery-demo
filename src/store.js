import { EventEmitter } from 'node:events';
import { newId } from './runtime.js';

// In-memory execution store. Plays the role of the backend that persists
// executions, steps, API/tool leaves, attempts, statuses, durations and costs.
export class Store extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.clear();
  }

  clear() {
    this.executions = new Map();
    this.nodes = new Map();
    this.checkpoints = new Map();
    this.incidents = new Map();
    this.revision = 0;
    this.nodeSeq = 0;
    this.incidentSeq = 0;
  }

  bump() {
    this.revision += 1;
    this.emit('change', this.revision);
  }

  touch() {
    this.bump();
  }

  createExecution(init) {
    const execution = {
      id: newId('exe'),
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      durationMs: null,
      error: null,
      ...init,
    };
    this.executions.set(execution.id, execution);
    this.nodes.set(execution.id, []);
    this.checkpoints.set(execution.id, []);
    this.emit('execution:created', execution);
    this.bump();
    return execution;
  }

  addNode(executionId, init) {
    const node = {
      id: `n${++this.nodeSeq}`,
      executionId,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      durationMs: null,
      cost: 0,
      attempts: [],
      ...init,
    };
    this.nodes.get(executionId).push(node);
    this.bump();
    return node;
  }

  finishExecution(execution, status, error) {
    execution.status = status;
    execution.endedAt = Date.now();
    execution.durationMs = execution.endedAt - execution.startedAt;
    execution.error = error
      ? { message: error.message, category: error.category ?? 'UNHANDLED' }
      : null;
    this.bump();
    this.emit('execution:ended', execution);
  }

  saveCheckpoint(executionId, cp) {
    const record = { ...cp, savedAt: Date.now() };
    this.checkpoints.get(executionId).push(record);
    this.bump();
    return record;
  }

  getCheckpoint(executionId, id) {
    return (this.checkpoints.get(executionId) ?? []).find((c) => c.id === id) ?? null;
  }

  latestCheckpoint(executionId) {
    const list = this.checkpoints.get(executionId) ?? [];
    return list.length ? list[list.length - 1] : null;
  }

  nodesOf(executionId) {
    return this.nodes.get(executionId) ?? [];
  }

  allExecutions() {
    return [...this.executions.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
}
