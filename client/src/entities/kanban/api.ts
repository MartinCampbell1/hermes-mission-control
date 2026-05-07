import { baseApi } from '../../shared/api/baseApi';

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

export interface KanbanTask {
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
  tasks: KanbanTask[];
  profiles: Array<{ id: string; name: string }>;
  tenants: string[];
  linearSymphony: {
    configured: boolean;
    message: string;
  };
}

export interface KanbanCreateTaskBody {
  title: string;
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

export const kanbanApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getKanban: build.query<KanbanSummary, { mode?: KanbanSource } | void>({
      query: (arg) => {
        const mode = arg && 'mode' in arg ? arg.mode : undefined;
        return mode ? `/kanban?mode=${mode}` : '/kanban';
      },
      providesTags: ['Kanban'],
    }),
    createKanbanTask: build.mutation<{ task: KanbanTask }, KanbanCreateTaskBody>({
      query: (body) => ({
        url: '/kanban',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Kanban'],
    }),
    moveKanbanTask: build.mutation<
      { task: KanbanTask },
      { id: string; lane: KanbanLaneId; position?: number }
    >({
      query: ({ id, ...body }) => ({
        url: `/kanban/${id}/move`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Kanban'],
    }),
    nudgeKanbanDispatcher: build.mutation<
      { ok: boolean; jobName?: string; scheduleAt?: string; sessionKeyPrefix?: string; error?: string },
      { boardId?: string; mode?: KanbanSource }
    >({
      query: (body) => ({
        url: '/kanban/nudge',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Workspace', 'Cron', 'CronGateway'],
    }),
  }),
});

export const {
  useGetKanbanQuery,
  useCreateKanbanTaskMutation,
  useMoveKanbanTaskMutation,
  useNudgeKanbanDispatcherMutation,
} = kanbanApi;
