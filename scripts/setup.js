import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureUserEnv, readPorts } from './ports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_ENV = path.join(ROOT, 'api', '.env');

ensureUserEnv();
const { apiPort, clientPort } = readPorts();

if (fs.existsSync(API_ENV)) {
  console.log(`${API_ENV} already exists; skipping setup.`);
  process.exit(0);
}

const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const BOOTSTRAP_EMAIL = process.env.HERMES_CLIENT_BOOTSTRAP_EMAIL || 'admin@local.hermes';
const BOOTSTRAP_PASSWORD =
  process.env.HERMES_CLIENT_BOOTSTRAP_PASSWORD || crypto.randomBytes(18).toString('base64url');

fs.writeFileSync(
  API_ENV,
  [
    `NODE_ENV=development`,
    `JWT_SECRET=${JWT_SECRET}`,
    `HERMES_CLIENT_BOOTSTRAP_EMAIL=${BOOTSTRAP_EMAIL}`,
    `HERMES_CLIENT_BOOTSTRAP_PASSWORD=${BOOTSTRAP_PASSWORD}`,
    `DB_PATH=./data/hermes.sqlite`,
    `PORT=${apiPort}`,
    `# CORS: by default the API allows every origin (single-user local app).`,
    `# To lock it down, set ALLOWED_DOMAIN to a comma-separated allowlist`,
    `# and uncomment HERMES_STRICT_CORS=1 below.`,
    `# ALLOWED_DOMAIN=http://localhost:${clientPort}`,
    `# HERMES_STRICT_CORS=1`,
    '',
  ].join('\n'),
);

console.log('Environment file created at api/.env');
console.log(`Port configuration at ~/.hermes_client/.env (api=${apiPort}, client=${clientPort})`);
console.log(`First-run email: ${BOOTSTRAP_EMAIL}`);
console.log('First-run password: stored in api/.env as HERMES_CLIENT_BOOTSTRAP_PASSWORD');
