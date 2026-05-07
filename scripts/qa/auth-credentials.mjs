import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_BOOTSTRAP_EMAIL = 'admin@local.hermes';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function readQaCredentials() {
  const localApiEnv = parseEnvFile(path.resolve('api/.env'));
  const installedApiEnv = parseEnvFile(path.join(os.homedir(), '.hermes_client', 'api', '.env'));
  const env = { ...localApiEnv, ...installedApiEnv, ...process.env };
  const email =
    env.HERMES_CLIENT_QA_EMAIL ||
    env.HERMES_CLIENT_EMAIL ||
    env.HERMES_CLIENT_BOOTSTRAP_EMAIL ||
    DEFAULT_BOOTSTRAP_EMAIL;
  const password =
    env.HERMES_CLIENT_QA_PASSWORD ||
    env.HERMES_CLIENT_PASSWORD ||
    env.HERMES_CLIENT_BOOTSTRAP_PASSWORD;

  if (!password) {
    throw new Error(
      'QA credentials are not configured. Set HERMES_CLIENT_QA_PASSWORD or run npm run setup so api/.env contains HERMES_CLIENT_BOOTSTRAP_PASSWORD.'
    );
  }

  return { email, password };
}
