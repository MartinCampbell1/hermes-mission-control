import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { CronJob } from '../../src/@types/cron';
import {
  buildWorkspaceSwarmOrchestratorPrompt,
  launchWorkspaceSwarmMission,
  normalizeWorkspaceSwarmLaunchRequest,
  getWorkspaceSwarmSummary,
} from '../../src/services/workspace/swarm';

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'hermes-client-workspace-'));
}

function cronJob(id: string, name: string): CronJob {
  return {
    id,
    profile: 'default',
    name,
    enabled: true,
    deleteAfterRun: true,
    createdAtMs: 1770000000000,
    updatedAtMs: 1770000000000,
    schedule: { kind: 'at', at: '2026-05-01T00:00:05Z' },
    payload: {},
    state: {},
  };
}

test('missing workspace runtime roots return an explicit unavailable summary', () => {
  const root = path.join(os.tmpdir(), `missing-hermes-workspace-${Date.now()}`);
  const summary = getWorkspaceSwarmSummary({ roots: [root] });

  assert.equal(summary.available, false);
  assert.equal(summary.source, 'not_found');
  assert.deepEqual(summary.missions, []);
  assert.deepEqual(summary.workers, []);
  assert.deepEqual(summary.artifacts, []);
  assert.equal(summary.launchDefaults.projectsDir, '/tmp');
  assert.equal(summary.launchDefaults.maxParallel, 1);
  assert.equal(summary.roleLanes.map((role) => role.name).join(','), 'Neo,Trinity,Morpheus,Oracle');
  assert.match(summary.note || '', /not found/i);
});

test('sample runtime JSON maps to missions, workers, and artifacts', () => {
  const root = tempDir();
  mkdirSync(path.join(root, '.runtime', 'tool-artifacts'), { recursive: true });
  writeFileSync(
    path.join(root, '.runtime', 'swarm-missions.json'),
    JSON.stringify({
      missions: [
        {
          id: 'mission-1',
          title: 'Ship continuity shell',
          state: 'executing',
          error: 'blocked on proof',
          updatedAt: 1770000000000,
        },
      ],
    })
  );
  writeFileSync(
    path.join(root, 'swarm-roster.json'),
    JSON.stringify({
      workers: [
        {
          id: 'swarm1',
          name: 'Trinity',
          role: 'research/evidence',
          state: 'idle',
          lastSeenAt: 1770000000050,
        },
      ],
    })
  );
  writeFileSync(
    path.join(root, '.runtime', 'tool-artifacts', 'index.json'),
    JSON.stringify({
      artifacts: {
        artifact_1: {
          id: 'artifact_1',
          title: 'Latest checkpoint',
          contentPath: '/tmp/checkpoint.md',
          status: 'checkpoint',
          createdAt: 1770000000100,
        },
      },
    })
  );

  const summary = getWorkspaceSwarmSummary({ roots: [root] });

  assert.equal(summary.available, true);
  assert.equal(summary.source, 'hermes_workspace_runtime');
  assert.equal(summary.missions[0].id, 'mission-1');
  assert.equal(summary.missions[0].title, 'Ship continuity shell');
  assert.equal(summary.missions[0].status, 'executing');
  assert.equal(summary.missions[0].error, 'blocked on proof');
  assert.equal(summary.workers[0].id, 'swarm1');
  assert.equal(summary.workers[0].name, 'Trinity');
  assert.equal(summary.workers[0].role, 'research/evidence');
  assert.match(summary.workers[0].updatedAt || '', /^2026-/);
  assert.equal(summary.artifacts[0].id, 'artifact_1');
  assert.equal(summary.artifacts[0].status, 'checkpoint');
});

test('malformed runtime file returns unavailable with note instead of throwing', () => {
  const root = tempDir();
  writeFileSync(path.join(root, 'swarm-missions.json'), '{not valid json');

  const summary = getWorkspaceSwarmSummary({ roots: [root] });

  assert.equal(summary.available, false);
  assert.equal(summary.source, 'not_found');
  assert.match(summary.note || '', /could not be read/i);
});

test('workspace launch prompt requires delegated worker tasks', () => {
  const normalized = normalizeWorkspaceSwarmLaunchRequest({
    goal: 'Audit the workspace route and write fixes',
    projectsDir: '/var/tmp',
    maxParallel: 3,
    workdir: '/repo',
  });

  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;

  const prompt = buildWorkspaceSwarmOrchestratorPrompt(normalized.value, {
    found: true,
    content: '# workspace-dispatch\nUse workers.',
    path: '/skills/workspace-dispatch/SKILL.md',
  });

  assert.match(prompt, /create_task/);
  assert.match(prompt, /delegate_task/);
  assert.match(prompt, /at most 6 tasks/i);
  assert.match(prompt, /Neo \(orchestrator\)/);
  assert.match(prompt, /Trinity \(research\/evidence\)/);
  assert.match(prompt, /Morpheus \(coding\/tests\)/);
  assert.match(prompt, /Oracle \(critique\/risk\)/);
  assert.match(prompt, /trinity-<slug>/);
  assert.match(prompt, /morpheus-<slug>/);
  assert.match(prompt, /oracle-<slug>/);
  assert.match(prompt, /\/var\/tmp\/dispatch-<slug>/);
  assert.match(prompt, /Do not complete the mission alone/i);
});

test('workspace launch rejects an empty goal without invoking Hermes', () => {
  let called = false;
  const result = launchWorkspaceSwarmMission(
    { goal: '   ' },
    {
      hermesRunner: () => {
        called = true;
        return { ok: true, stdout: '', stderr: '' };
      },
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, 'goal required');
  assert.equal(called, false);
});

test('workspace launch uses Hermes cron create args without runtime-only skill dependency', () => {
  const now = new Date('2026-05-01T00:00:00.000Z');
  const expectedJobName = `workspace-swarm-ship-real-swarm-${now.getTime()}`;
  let capturedArgs: string[] = [];
  let capturedPrompt = '';

  const result = launchWorkspaceSwarmMission(
    {
      goal: 'Ship real swarm',
      profile: 'neo',
      projectsDir: '/tmp/projects',
      orchestratorModel: 'gpt-orchestrator',
      workerModel: 'gpt-worker',
      maxParallel: 2,
      workdir: '/work/tree',
    },
    {
      now: () => now,
      loadSkill: () => ({ found: true, content: 'workspace dispatch skill' }),
      hermesRunner: (args, opts) => {
        capturedArgs = args;
        capturedPrompt = args[args.length - 1];
        assert.equal(opts?.profile, 'neo');
        assert.equal(opts?.timeoutMs, 60000);
        return { ok: true, stdout: 'created', stderr: '' };
      },
      listJobs: () => [cronJob('abc123', expectedJobName)],
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.jobName, expectedJobName);
  assert.equal(result.scheduleAt, '1m');
  assert.equal(result.sessionKeyPrefix, 'cron_abc123_');
  assert.deepEqual(capturedArgs.slice(0, 11), [
    'cron',
    'create',
    '--name',
    expectedJobName,
    '--deliver',
    'local',
    '--repeat',
    '1',
    '--workdir',
    '/work/tree',
    '1m',
  ]);
  assert.equal(capturedArgs.includes('--skill'), false);
  assert.equal(capturedArgs[capturedArgs.length - 2], '1m');
  assert.match(capturedPrompt, /Goal: Ship real swarm/);
  assert.match(capturedPrompt, /workspace dispatch skill/);
  assert.match(capturedPrompt, /Run no more than 2 worker tasks in parallel/);
  assert.match(capturedPrompt, /Preferred orchestrator model: gpt-orchestrator/);
  assert.match(capturedPrompt, /Preferred worker model: gpt-worker/);
});

test('workspace launch clamps maxParallel to the supported range', () => {
  let capturedPrompt = '';

  const result = launchWorkspaceSwarmMission(
    { goal: 'Clamp workers', maxParallel: 99 },
    {
      now: () => new Date('2026-05-01T00:00:00.000Z'),
      loadSkill: () => ({ found: false, content: '' }),
      hermesRunner: (args) => {
        capturedPrompt = args[args.length - 1];
        return { ok: true, stdout: '', stderr: '' };
      },
      listJobs: () => [],
    }
  );

  assert.equal(result.ok, true);
  assert.match(capturedPrompt, /Max parallel workers: 5/);
  assert.match(capturedPrompt, /Run no more than 5 worker tasks in parallel/);
});

test('workspace launch embeds local skill text instead of depending on Hermes skill registry', () => {
  const now = new Date('2026-05-01T00:00:00.000Z');
  const calls: string[][] = [];
  let capturedPrompt = '';

  const result = launchWorkspaceSwarmMission(
    { goal: 'Registry independent dispatch' },
    {
      now: () => now,
      loadSkill: () => ({ found: true, content: 'workspace dispatch skill' }),
      hermesRunner: (args) => {
        calls.push(args);
        capturedPrompt = args[args.length - 1];
        return { ok: true, stdout: 'created without skill flag', stderr: '' };
      },
      listJobs: () => [cronJob('retry123', `workspace-swarm-registry-independent-dispatch-${now.getTime()}`)],
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.sessionKeyPrefix, 'cron_retry123_');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('--skill'), false);
  assert.match(capturedPrompt, /workspace dispatch skill/);
});

test('workspace launch treats Hermes cron create failure text as a failed launch', () => {
  const result = launchWorkspaceSwarmMission(
    { goal: 'Surface failed cron create' },
    {
      now: () => new Date('2026-05-01T00:00:00.000Z'),
      loadSkill: () => ({ found: false, content: '' }),
      hermesRunner: () => ({
        ok: true,
        stdout: "Failed to create job: Invalid schedule '5s'.",
        stderr: '',
      }),
      listJobs: () => [],
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.error || '', /Failed to create job/i);
});
