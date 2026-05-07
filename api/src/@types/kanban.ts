import { RequestHandler } from 'express';

export type KanbanSource = 'local' | 'linear_symphony';
export type KanbanLaneId = 'triage' | 'todo' | 'ready' | 'progress' | 'blocked' | 'done';

export interface KanbanBoard {
  id: string;
  name: string;
  count: number;
}

export interface KanbanLane {
  id: KanbanLaneId;
  name: string;
  hue: number;
  description: string;
}

export interface KanbanTaskResponse {
  id: string;
  source: KanbanSource;
  boardId: string;
  boardName: string;
  lane: KanbanLaneId;
  priority: string;
  title: string;
  description: string;
  tag: string;
  assignee: string | null;
  agent: string | null;
  tenant: string;
  position: number;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanSummary {
  mode: KanbanSource;
  availableModes: Array<{
    id: KanbanSource;
    label: string;
    enabled: boolean;
    description: string;
  }>;
  boards: KanbanBoard[];
  lanes: KanbanLane[];
  tasks: KanbanTaskResponse[];
  profiles: Array<{ id: string; name: string }>;
  tenants: string[];
  linearSymphony: {
    configured: boolean;
    message: string;
  };
}

export interface KanbanCreateTaskBody {
  title?: string;
  description?: string;
  boardId?: string;
  boardName?: string;
  lane?: KanbanLaneId;
  priority?: string;
  tag?: string;
  assignee?: string | null;
  agent?: string | null;
  tenant?: string;
}

export interface KanbanUpdateTaskBody extends Partial<KanbanCreateTaskBody> {
  position?: number;
}

export interface KanbanMoveTaskBody {
  lane?: KanbanLaneId;
  position?: number;
}

export type GetKanbanSummary = RequestHandler<never, KanbanSummary, never, { mode?: KanbanSource }>;
export type CreateKanbanTask = RequestHandler<never, { task: KanbanTaskResponse }, KanbanCreateTaskBody, never>;
export type UpdateKanbanTask = RequestHandler<{ id: string }, { task: KanbanTaskResponse }, KanbanUpdateTaskBody, never>;
export type MoveKanbanTask = RequestHandler<{ id: string }, { task: KanbanTaskResponse }, KanbanMoveTaskBody, never>;
export type DeleteKanbanTask = RequestHandler<{ id: string }, { ok: boolean }, never, never>;
export type NudgeKanbanDispatcher = RequestHandler<
  never,
  { ok: boolean; jobName?: string; scheduleAt?: string; sessionKeyPrefix?: string; error?: string },
  { boardId?: string; mode?: KanbanSource },
  never
>;
