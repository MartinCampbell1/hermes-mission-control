#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { readQaCredentials } from './auth-credentials.mjs';

const appUrl = (process.env.HERMES_CLIENT_URL || 'http://localhost:18888').replace(/\/+$/, '');
const appOrigin = new URL(appUrl);
const apiUrl = (
  process.env.HERMES_CLIENT_API_URL ||
  `${appOrigin.protocol}//${appOrigin.hostname}:18889/api`
).replace(/\/+$/, '');
const { email, password } = readQaCredentials();
const profile = process.env.HERMES_CLIENT_WORKSPACE_QA_PROFILE || 'default';
const projectsDir = process.env.HERMES_CLIENT_WORKSPACE_QA_PROJECTS_DIR || '/tmp';
const workdir = process.env.HERMES_CLIENT_WORKSPACE_QA_WORKDIR || process.cwd();
const artifactDir = path.resolve('docs/qa/e2e/artifacts');

const summary = {
  startedAt: new Date().toISOString(),
  apiUrl,
  profile,
  checks: [],
};

function record(name, ok, details = {}) {
  summary.checks.push({ name, ok, ...details });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

async function writeArtifact() {
  await fs.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(
    artifactDir,
    `workspace-launch-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  await fs.writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`ARTIFACT ${artifactPath}`);
}

async function request(pathname, token, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const error = new Error(`${pathname} failed with ${response.status}`);
    error.response = body;
    throw error;
  }
  return body;
}

async function login() {
  const body = await request('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const token = body?.accessToken || body?.token;
  if (!token) throw new Error('Login response did not include an access token.');
  return token;
}

function jobIdFromSessionKeyPrefix(prefix) {
  if (typeof prefix !== 'string') return null;
  const match = /^cron_([^_]+)_$/.exec(prefix);
  return match?.[1] || null;
}

async function listJobs(token) {
  const body = await request('/cron', token);
  return Array.isArray(body?.jobs) ? body.jobs : [];
}

async function deleteJob(token, jobId) {
  return request(`/cron/${encodeURIComponent(jobId)}?profile=${encodeURIComponent(profile)}`, token, {
    method: 'DELETE',
  });
}

async function main() {
  let token = null;
  let createdJobName = null;
  let createdJobId = null;

  try {
    token = await login();
    record('login', true, { email });

    const goal = `QA_WORKSPACE_LAUNCH_SMOKE_${new Date().toISOString()}`;
    const launch = await request('/workspace/swarm/launch', token, {
      method: 'POST',
      body: JSON.stringify({
        goal,
        profile,
        projectsDir,
        workdir,
        orchestratorModel: 'qa-orchestrator-model',
        workerModel: 'qa-worker-model',
        maxParallel: 1,
        supervised: true,
      }),
    });
    createdJobName = launch?.jobName || null;
    createdJobId = jobIdFromSessionKeyPrefix(launch?.sessionKeyPrefix);

    const launchOk =
      launch?.ok === true &&
      typeof launch?.jobName === 'string' &&
      launch.jobName.startsWith('workspace-swarm-') &&
      launch.scheduleAt === '1m';
    record('workspace launch API schedules cron job', launchOk, {
      jobName: createdJobName,
      scheduleAt: launch?.scheduleAt,
      sessionKeyPrefix: launch?.sessionKeyPrefix,
    });
    if (!launchOk) throw new Error(`Unexpected launch response: ${JSON.stringify(launch)}`);

    const jobsAfterLaunch = await listJobs(token);
    const createdJob = jobsAfterLaunch.find((job) => job.name === createdJobName);
    createdJobId = createdJob?.id || createdJobId;
    const jobVisible = Boolean(createdJobId);
    record('scheduled job is visible in cron list', jobVisible, {
      jobId: createdJobId,
      jobName: createdJobName,
    });
    if (!jobVisible) throw new Error(`Could not find scheduled job ${createdJobName} in cron list.`);

    await deleteJob(token, createdJobId);
    record('scheduled smoke job cleanup request succeeds', true, {
      jobId: createdJobId,
      jobName: createdJobName,
    });

    const jobsAfterCleanup = await listJobs(token);
    const stillPresent = jobsAfterCleanup.some(
      (job) => job.id === createdJobId || job.name === createdJobName
    );
    record('scheduled smoke job is removed from cron list', !stillPresent, {
      jobId: createdJobId,
      jobName: createdJobName,
    });
    if (stillPresent) throw new Error(`Smoke job ${createdJobName} still exists after cleanup.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record('workspace launch smoke failed', false, {
      error: message,
      response: error?.response,
      cleanupHint:
        createdJobId || createdJobName
          ? `Delete cron job id=${createdJobId || 'unknown'} name=${createdJobName || 'unknown'} profile=${profile}`
          : undefined,
    });

    if (token && createdJobId) {
      try {
        await deleteJob(token, createdJobId);
        record('best-effort cleanup after failure', true, { jobId: createdJobId });
      } catch (cleanupError) {
        record('best-effort cleanup after failure', false, {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          jobId: createdJobId,
        });
      }
    }

    process.exitCode = 1;
  } finally {
    await writeArtifact();
  }
}

main();
