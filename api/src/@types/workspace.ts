import { RequestHandler } from 'express';

export interface WorkspaceSwarmMission {
  id: string;
  title: string;
  status: string;
  updatedAt: string | null;
  error: string | null;
}

export interface WorkspaceSwarmWorker {
  id: string;
  name: string;
  status: string;
  role: string | null;
  updatedAt: string | null;
  error: string | null;
}

export interface WorkspaceSwarmArtifact {
  id: string;
  title: string;
  path: string;
  status: string | null;
  updatedAt: string | null;
  error: string | null;
}

export interface WorkspaceSwarmLaunchDefaults {
  profile: string | null;
  projectsDir: string;
  orchestratorModel: string | null;
  workerModel: string | null;
  maxParallel: number;
  supervised: boolean;
  workdir: string;
}

export interface WorkspaceSwarmRoleLane {
  id: string;
  name: string;
  role: string;
  description: string;
}

export interface WorkspaceSwarmSummary {
  available: boolean;
  source: 'hermes_workspace_runtime' | 'not_found';
  missions: WorkspaceSwarmMission[];
  workers: WorkspaceSwarmWorker[];
  artifacts: WorkspaceSwarmArtifact[];
  launchDefaults: WorkspaceSwarmLaunchDefaults;
  roleLanes: WorkspaceSwarmRoleLane[];
  note?: string;
}

export interface WorkspaceSwarmLaunchRequest {
  goal?: string;
  profile?: string;
  projectsDir?: string;
  orchestratorModel?: string;
  workerModel?: string;
  maxParallel?: number | string;
  supervised?: boolean | string;
  workdir?: string;
}

export interface WorkspaceSwarmLaunchResponse {
  ok: boolean;
  jobName?: string;
  scheduleAt?: string;
  sessionKeyPrefix?: string;
  raw?: string;
  error?: string;
}

export type GetSwarmSummary = RequestHandler<never, WorkspaceSwarmSummary, never, never>;
export type LaunchSwarmMission = RequestHandler<
  never,
  WorkspaceSwarmLaunchResponse,
  WorkspaceSwarmLaunchRequest,
  never
>;
