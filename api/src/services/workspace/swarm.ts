import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import {
  WorkspaceSwarmArtifact,
  WorkspaceSwarmLaunchDefaults,
  WorkspaceSwarmLaunchRequest,
  WorkspaceSwarmLaunchResponse,
  WorkspaceSwarmMission,
  WorkspaceSwarmRoleLane,
  WorkspaceSwarmSummary,
  WorkspaceSwarmWorker,
} from '../../@types/workspace';
import { CronJob } from '../../@types/cron';
import { hermesExec, HermesExecResult } from '../hermes/cli';
import { listCronJobs } from '../hermes/cron';

const DEFAULT_WORKSPACE_ROOT =
  process.env.HERMES_WORKSPACE_ROOT || path.join(homedir(), 'hermes-workspace');
const DEFAULT_CLIENT_WORKDIR = process.env.HERMES_CLIENT_WORKDIR || process.cwd();
const DEFAULT_PROJECTS_DIR = process.env.HERMES_PROJECTS_DIR || '/tmp';
const DEFAULT_MAX_PARALLEL = 1;

const LAUNCH_DEFAULTS: WorkspaceSwarmLaunchDefaults = {
  profile: null,
  projectsDir: DEFAULT_PROJECTS_DIR,
  orchestratorModel: null,
  workerModel: null,
  maxParallel: DEFAULT_MAX_PARALLEL,
  supervised: false,
  workdir: DEFAULT_CLIENT_WORKDIR,
};

const CONTROLLED_SWARM_ROLE_LANES: WorkspaceSwarmRoleLane[] = [
  {
    id: 'neo',
    name: 'Neo',
    role: 'orchestrator',
    description: 'Owns mission decomposition, worker dispatch, and final synthesis.',
  },
  {
    id: 'trinity',
    name: 'Trinity',
    role: 'research/evidence',
    description: 'Collects repo evidence, acceptance proof, and external constraints.',
  },
  {
    id: 'morpheus',
    name: 'Morpheus',
    role: 'coding/tests',
    description: 'Implements scoped code changes and keeps tests/builds green.',
  },
  {
    id: 'oracle',
    name: 'Oracle',
    role: 'critique/risk',
    description: 'Reviews high-stakes choices, failure modes, and readiness claims.',
  },
];

const KNOWN_MISSION_FILES = [
  'swarm-missions.json',
  'missions.json',
  path.join('.runtime', 'swarm-missions.json'),
];

const KNOWN_WORKER_FILES = [
  'swarm-roster.json',
  'workers.json',
  'runtime.json',
  path.join('.runtime', 'swarm-roster.json'),
];

const KNOWN_ARTIFACT_FILES = [
  'artifacts.json',
  path.join('tool-artifacts', 'index.json'),
  path.join('.runtime', 'tool-artifacts', 'index.json'),
];

function candidateRoots(root = DEFAULT_WORKSPACE_ROOT): string[] {
  return [
    path.join(root, '.hermes-workspace'),
    path.join(root, 'data'),
    path.join(root, '.swarm'),
    path.join(root, '.runtime'),
    root,
  ];
}

function safeStat(filePath: string) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function readJsonFile(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function errorValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function dateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
}

function toArray(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  const nested = record[key];
  if (Array.isArray(nested)) return nested;
  if (nested && typeof nested === 'object') return Object.values(nested as Record<string, unknown>);
  return [];
}

function mapMission(value: unknown, index: number): WorkspaceSwarmMission | null {
  const record = asRecord(value);
  const id = stringValue(record.id ?? record.missionId, `mission-${index + 1}`);
  const title = stringValue(record.title ?? record.name ?? record.task, id);
  const status = stringValue(record.status ?? record.state ?? record.phase, 'unknown');
  return {
    id,
    title,
    status,
    updatedAt: dateValue(
      record.updatedAt ?? record.updated_at ?? record.lastUpdatedAt ?? record.completedAt ?? record.createdAt
    ),
    error: errorValue(record.error, record.lastError, record.failureReason, record.failure, record.message),
  };
}

function mapWorker(value: unknown, index: number): WorkspaceSwarmWorker | null {
  const record = asRecord(value);
  const id = stringValue(record.id ?? record.workerId, `worker-${index + 1}`);
  const name = stringValue(record.name ?? record.agent ?? record.label, id);
  const status = stringValue(record.status ?? record.state ?? record.phase, 'unknown');
  const role = stringValue(record.role ?? record.kind ?? record.capability, '') || null;
  return {
    id,
    name,
    status,
    role,
    updatedAt: dateValue(record.updatedAt ?? record.updated_at ?? record.lastSeenAt ?? record.createdAt),
    error: errorValue(record.error, record.lastError, record.failureReason, record.message),
  };
}

function mapArtifact(value: unknown, index: number): WorkspaceSwarmArtifact | null {
  const record = asRecord(value);
  const id = stringValue(record.id ?? record.artifactId, `artifact-${index + 1}`);
  const title = stringValue(record.title ?? record.name ?? record.summary, id);
  const artifactPath = stringValue(record.path ?? record.contentPath ?? record.filePath, '');
  return {
    id,
    title,
    path: artifactPath,
    status: stringValue(record.status ?? record.state ?? record.phase, '') || null,
    updatedAt: dateValue(record.updatedAt ?? record.updated_at ?? record.createdAt ?? record.created_at),
    error: errorValue(record.error, record.lastError, record.failureReason, record.message),
  };
}

function readKnownFiles<T>(
  root: string,
  relativeFiles: string[],
  key: string,
  mapper: (value: unknown, index: number) => T | null
): { items: T[]; errors: string[] } {
  const items: T[] = [];
  const errors: string[] = [];

  relativeFiles.forEach((relativeFile) => {
    const filePath = path.join(root, relativeFile);
    if (!safeStat(filePath)?.isFile()) return;
    try {
      toArray(readJsonFile(filePath), key).forEach((value, index) => {
        const item = mapper(value, index);
        if (item) items.push(item);
      });
    } catch (error) {
      errors.push(`${relativeFile}: ${(error as Error).message}`);
    }
  });

  return { items, errors };
}

function readCheckpointArtifacts(root: string): WorkspaceSwarmArtifact[] {
  const checkpointsDir = path.join(root, 'checkpoints');
  if (!safeStat(checkpointsDir)?.isDirectory()) return [];

  try {
    return readdirSync(checkpointsDir)
      .filter((name) => !name.startsWith('.'))
      .slice(0, 20)
      .map((name, index) => {
        const filePath = path.join(checkpointsDir, name);
        const stat = safeStat(filePath);
        return {
          id: `checkpoint-${index + 1}`,
          title: name,
          path: filePath,
          status: 'checkpoint',
          updatedAt: stat ? stat.mtime.toISOString() : null,
          error: null,
        };
      });
  } catch {
    return [];
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  items.forEach((item) => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  return [...byId.values()];
}

export interface WorkspaceDispatchSkill {
  found: boolean;
  content: string;
  path?: string;
}

export interface NormalizedWorkspaceSwarmLaunchRequest {
  goal: string;
  profile?: string;
  projectsDir: string;
  orchestratorModel?: string;
  workerModel?: string;
  maxParallel: number;
  supervised: boolean;
  workdir: string;
}

export interface WorkspaceSwarmLaunchDeps {
  hermesRunner?: (
    args: string[],
    opts?: { profile?: string | null; timeoutMs?: number; env?: Record<string, string> }
  ) => HermesExecResult;
  listJobs?: () => CronJob[];
  loadSkill?: () => WorkspaceDispatchSkill;
  now?: () => Date;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function boolValue(value: unknown): boolean {
  return value === true || value === 'true';
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return slug || 'mission';
}

function relativeOneShotSchedule(minutes: number): string {
  return `${minutes}m`;
}

function looksLikeCronCreateFailure(output: string): boolean {
  return /failed to create job|invalid schedule|error creating/i.test(output);
}

export function normalizeWorkspaceSwarmLaunchRequest(
  request: WorkspaceSwarmLaunchRequest
): { ok: true; value: NormalizedWorkspaceSwarmLaunchRequest } | { ok: false; error: string } {
  const goal = optionalString(request.goal);
  if (!goal) return { ok: false, error: 'goal required' };

  const profile = optionalString(request.profile);
  const projectsDir = optionalString(request.projectsDir) ?? DEFAULT_PROJECTS_DIR;
  const workdir = optionalString(request.workdir) ?? DEFAULT_CLIENT_WORKDIR;
  const orchestratorModel = optionalString(request.orchestratorModel);
  const workerModel = optionalString(request.workerModel);
  const maxParallel = clampInt(request.maxParallel, DEFAULT_MAX_PARALLEL, 1, 5);
  const supervised = boolValue(request.supervised);

  return {
    ok: true,
    value: {
      goal,
      profile,
      projectsDir,
      orchestratorModel,
      workerModel,
      maxParallel,
      supervised,
      workdir,
    },
  };
}

export function loadWorkspaceDispatchSkill(): WorkspaceDispatchSkill {
  const candidates = [
    path.join(DEFAULT_WORKSPACE_ROOT, 'skills', 'workspace-dispatch', 'SKILL.md'),
    path.join(process.cwd(), 'skills', 'workspace-dispatch', 'SKILL.md'),
    path.join(homedir(), '.hermes', 'skills', 'workspace-dispatch', 'SKILL.md'),
  ];

  for (const candidate of candidates) {
    try {
      return { found: true, content: readFileSync(candidate, 'utf8'), path: candidate };
    } catch {
      // Continue through candidates; the launch prompt still carries fallback rules.
    }
  }

  return { found: false, content: '' };
}

export function buildWorkspaceSwarmOrchestratorPrompt(
  input: NormalizedWorkspaceSwarmLaunchRequest,
  skill: WorkspaceDispatchSkill = loadWorkspaceDispatchSkill()
): string {
  const missionSlug = slugify(input.goal);
  const outputPath = path.join(input.projectsDir, 'dispatch-<slug>');
  const sampleOutputPath = path.join(input.projectsDir, `dispatch-${missionSlug}`);
  const roleLines = CONTROLLED_SWARM_ROLE_LANES.map(
    (role) => `- ${role.name} (${role.role}): ${role.description}`
  );

  return [
    'You are the Hermes Workspace Conductor for a real swarm mission.',
    '',
    '## Mission',
    `Goal: ${input.goal}`,
    `Working directory: ${input.workdir}`,
    `Worker output root: ${outputPath}`,
    `Example mission output root: ${sampleOutputPath}`,
    `Max parallel workers: ${input.maxParallel}`,
    input.supervised
      ? 'Supervised mode: ask for approval before starting each worker task.'
      : 'Supervised mode: off; start worker tasks without asking for confirmation.',
    input.orchestratorModel ? `Preferred orchestrator model: ${input.orchestratorModel}` : '',
    input.workerModel ? `Preferred worker model: ${input.workerModel}` : '',
    '',
    '## Controlled Agent Roster',
    ...roleLines,
    '',
    '## Workspace Dispatch Skill',
    skill.content ||
      'workspace-dispatch skill was not found locally. Use the fallback dispatch rules below.',
    '',
    '## Required Dispatch Rules',
    '- Use create_task and delegate_task to spawn worker agents. Do not complete the mission alone.',
    '- Decompose the goal into at most 6 tasks with machine-checkable exit criteria.',
    '- Keep Neo as the orchestrator. Neo owns decomposition, delegation, synchronization, and final synthesis.',
    '- Prefer Trinity for research/evidence tasks, Morpheus for coding/tests tasks, and Oracle for critique/risk tasks.',
    '- Label delegated workers with the controlled role prefix: trinity-<slug>, morpheus-<slug>, or oracle-<slug>.',
    `- Run no more than ${input.maxParallel} worker tasks in parallel.`,
    `- Tell workers to write their outputs under ${outputPath}.`,
    '- Give every worker a self-contained prompt including cwd, task scope, files, and exit criteria.',
    '- Workers must not start long-running servers, watchers, polling loops, or attached logs.',
    '- After delegating the tasks, report the task roster, expected output paths, and tracking hints.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function workspaceLaunchJobName(goal: string, now: Date): string {
  return `workspace-swarm-${slugify(goal)}-${now.getTime()}`;
}

function buildCronCreateArgs(input: {
  jobName: string;
  scheduleAt: string;
  workdir: string;
  prompt: string;
}): string[] {
  const args = ['cron', 'create', '--name', input.jobName, '--deliver', 'local', '--repeat', '1'];
  args.push('--workdir', input.workdir, input.scheduleAt, input.prompt);
  return args;
}

export function launchWorkspaceSwarmMission(
  request: WorkspaceSwarmLaunchRequest,
  deps: WorkspaceSwarmLaunchDeps = {}
): WorkspaceSwarmLaunchResponse {
  const normalized = normalizeWorkspaceSwarmLaunchRequest(request);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const now = deps.now ? deps.now() : new Date();
  const scheduleAt = relativeOneShotSchedule(1);
  const jobName = workspaceLaunchJobName(normalized.value.goal, now);
  const skill = deps.loadSkill ? deps.loadSkill() : loadWorkspaceDispatchSkill();
  const prompt = buildWorkspaceSwarmOrchestratorPrompt(normalized.value, skill);
  const runner = deps.hermesRunner ?? hermesExec;
  const runnerOpts = {
    profile: normalized.value.profile ?? null,
    timeoutMs: 60000,
  };
  const args = buildCronCreateArgs({
    jobName,
    scheduleAt,
    workdir: normalized.value.workdir,
    prompt,
  });
  const result = runner(args, runnerOpts);
  const raw = `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();

  if (!result.ok || looksLikeCronCreateFailure(raw)) {
    return { ok: false, jobName, scheduleAt, raw, error: result.stderr || result.stdout || result.error };
  }

  let sessionKeyPrefix: string | undefined;
  try {
    const jobs = deps.listJobs ? deps.listJobs() : listCronJobs();
    const created = jobs.find((job) => job.name === jobName);
    if (created?.id) sessionKeyPrefix = `cron_${created.id}_`;
  } catch {
    sessionKeyPrefix = undefined;
  }

  return { ok: true, jobName, scheduleAt, sessionKeyPrefix, raw };
}

export function getWorkspaceSwarmSummary(options?: { roots?: string[] }): WorkspaceSwarmSummary {
  const roots = options?.roots ?? candidateRoots();
  const existingRoots = roots.filter((root) => safeStat(root)?.isDirectory());
  if (existingRoots.length === 0) {
    return {
      available: false,
      source: 'not_found',
      missions: [],
      workers: [],
      artifacts: [],
      launchDefaults: LAUNCH_DEFAULTS,
      roleLanes: CONTROLLED_SWARM_ROLE_LANES,
      note: 'Hermes Workspace runtime directory not found.',
    };
  }

  const errors: string[] = [];
  const missions: WorkspaceSwarmMission[] = [];
  const workers: WorkspaceSwarmWorker[] = [];
  const artifacts: WorkspaceSwarmArtifact[] = [];

  existingRoots.forEach((root) => {
    const missionResult = readKnownFiles(root, KNOWN_MISSION_FILES, 'missions', mapMission);
    const workerResult = readKnownFiles(root, KNOWN_WORKER_FILES, 'workers', mapWorker);
    const artifactResult = readKnownFiles(root, KNOWN_ARTIFACT_FILES, 'artifacts', mapArtifact);

    missions.push(...missionResult.items);
    workers.push(...workerResult.items);
    artifacts.push(...artifactResult.items, ...readCheckpointArtifacts(root));
    errors.push(...missionResult.errors, ...workerResult.errors, ...artifactResult.errors);
  });

  const summary: WorkspaceSwarmSummary = {
    available: missions.length > 0 || workers.length > 0 || artifacts.length > 0,
    source: 'hermes_workspace_runtime',
    missions: dedupeById(missions).slice(0, 30),
    workers: dedupeById(workers).slice(0, 50),
    artifacts: dedupeById(artifacts).slice(0, 50),
    launchDefaults: LAUNCH_DEFAULTS,
    roleLanes: CONTROLLED_SWARM_ROLE_LANES,
  };

  if (!summary.available) {
    summary.source = 'not_found';
    summary.note = errors.length
      ? `Workspace runtime files were found but could not be read: ${errors.slice(0, 3).join('; ')}`
      : 'Workspace runtime directory exists, but no swarm missions, workers, or artifacts were found.';
  } else if (errors.length) {
    summary.note = `Some Workspace runtime files could not be read: ${errors.slice(0, 3).join('; ')}`;
  }

  return summary;
}
