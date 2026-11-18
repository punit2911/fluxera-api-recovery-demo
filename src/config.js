import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export function loadConfig(env = process.env) {
  const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  return {
    port: num(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    publicDir: path.join(ROOT, 'public'),
    webhookSecret: env.RECOVERY_WEBHOOK_SECRET || 'demo-shared-secret-change-me',
    // When empty the demo integration's own endpoint is used.
    webhookUrl: env.RECOVERY_WEBHOOK_URL || null,
    videoUrl: env.VIDEO_URL || null,
    speed: num(env.DEMO_SPEED, 1),
    notifyFailCount: num(env.NOTIFY_FAIL_COUNT, 1),
  };
}
