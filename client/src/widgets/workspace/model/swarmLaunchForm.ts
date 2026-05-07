import type {
  WorkspaceSwarmLaunchDefaults,
  WorkspaceSwarmLaunchRequest,
} from '../../../entities/workspace';

export interface SwarmLaunchFormState {
  goal: string;
  profile: string;
  projectsDir: string;
  orchestratorModel: string;
  workerModel: string;
  maxParallel: string;
  supervised: boolean;
  workdir: string;
}

export type SwarmStatusColor = 'default' | 'success' | 'warning' | 'error' | 'info';

export const FALLBACK_WORKSPACE_SWARM_DEFAULTS: WorkspaceSwarmLaunchDefaults = {
  profile: null,
  projectsDir: '~/projects',
  orchestratorModel: null,
  workerModel: null,
  maxParallel: 1,
  supervised: false,
  workdir: '.',
};

function optionalFormValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function formStateFromDefaults(
  defaults: WorkspaceSwarmLaunchDefaults = FALLBACK_WORKSPACE_SWARM_DEFAULTS
): SwarmLaunchFormState {
  return {
    goal: '',
    profile: defaults.profile ?? '',
    projectsDir: defaults.projectsDir,
    orchestratorModel: defaults.orchestratorModel ?? '',
    workerModel: defaults.workerModel ?? '',
    maxParallel: String(defaults.maxParallel),
    supervised: defaults.supervised,
    workdir: defaults.workdir,
  };
}

export function buildWorkspaceSwarmLaunchRequest(
  form: SwarmLaunchFormState
): WorkspaceSwarmLaunchRequest {
  const profile = optionalFormValue(form.profile);
  const projectsDir = optionalFormValue(form.projectsDir);
  const orchestratorModel = optionalFormValue(form.orchestratorModel);
  const workerModel = optionalFormValue(form.workerModel);
  const workdir = optionalFormValue(form.workdir);
  const maxParallelText = optionalFormValue(form.maxParallel);
  const maxParallel = maxParallelText ? Number(maxParallelText) : Number.NaN;

  return {
    goal: form.goal.trim(),
    ...(profile ? { profile } : {}),
    ...(projectsDir ? { projectsDir } : {}),
    ...(orchestratorModel ? { orchestratorModel } : {}),
    ...(workerModel ? { workerModel } : {}),
    ...(Number.isFinite(maxParallel) ? { maxParallel } : {}),
    supervised: form.supervised,
    ...(workdir ? { workdir } : {}),
  };
}

export function formatWorkspaceSwarmDate(value: string | null): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function workspaceSwarmStatusColor(status: string | null | undefined): SwarmStatusColor {
  const normalized = status?.toLowerCase() ?? '';
  if (/fail|error|crash|cancel|blocked/.test(normalized)) return 'error';
  if (/done|success|complete|passed|finished/.test(normalized)) return 'success';
  if (/running|executing|active|working|scheduled|queued|pending/.test(normalized)) return 'info';
  if (/stale|paused|waiting|review|checkpoint/.test(normalized)) return 'warning';
  return 'default';
}
