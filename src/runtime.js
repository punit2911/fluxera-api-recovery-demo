import { randomBytes } from 'node:crypto';

// Global pacing knob. 1 = normal, 2 = slower for presenting, 0 = no delays (tests).
export const runtime = { speed: 1 };

export const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms * runtime.speed))));

export const newId = (prefix) => `${prefix}_${randomBytes(5).toString('hex')}`;
