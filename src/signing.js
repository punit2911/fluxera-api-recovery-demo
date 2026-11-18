import { createHmac, timingSafeEqual } from 'node:crypto';

export function sign(secret, timestamp, body) {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${mac}`;
}

export function verify(secret, timestamp, body, signature, toleranceMs = 5 * 60 * 1000) {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > toleranceMs) return false;
  const expected = Buffer.from(sign(secret, timestamp, body));
  const given = Buffer.from(String(signature));
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
