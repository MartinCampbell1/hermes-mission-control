import AppDataSource from '../../data-source';
import { Agent, KanbanTask } from '../../entities';
import {
  KanbanCreateTaskBody,
  KanbanLane,
  KanbanLaneId,
  KanbanSource,
  KanbanSummary,
  KanbanTaskResponse,
  KanbanUpdateTaskBody,
} from '../../@types/kanban';
import { launchWorkspaceSwarmMission } from '../workspace/swarm';

const DEFAULT_BOARD_ID = 'default';
const DEFAULT_BOARD_NAME = 'Default';

export const KANBAN_LANES: KanbanLane[] = [
  { id: 'triage', name: 'Triage', hue: 280, description: 'Raw ideas — a specifier will flesh out the spec' },
  { id: 'todo', name: 'Todo', hue: 220, description: 'Waiting on dependencies or unassigned' },
  { id: 'ready', name: 'Ready', hue: 50, description: 'Assigned and waiting for a dispatcher tick' },
  { id: 'progress', name: 'In Progress', hue: 145, description: 'Claimed by a worker — in-flight' },
  { id: 'blocked', name: 'Blocked', hue: 10, description: 'Worker asked for human input' },
  { id: 'done', name: 'Done', hue: 200, description: 'Completed' },
];

const VALID_LANES = new Set(KANBAN_LANES.map((lane) => lane.id));
const VALID_PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4', 'P5']);

function isLane(value: unknown): value is KanbanLaneId {
  return typeof value === 'string' && VALID_LANES.has(value as KanbanLaneId);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizePriority(value: unknown): string {
  const priority = readString(value, 'P3').toUpperCase();
  return VALID_PRIORITIES.has(priority) ? priority : 'P3';
}

function normalizeMode(value: unknown): KanbanSource {
  return value === 'linear_symphony' ? 'linear_symphony' : 'local';
}

function generateTaskId(): string {
  return `T_${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

function taskRepo() {
  return AppDataSource.getRepository(KanbanTask);
}

function toResponse(task: KanbanTask): KanbanTaskResponse {
  return {
    id: task.id,
    source: task.source,
    boardId: task.boardId,
    boardName: task.boardName,
    lane: isLane(task.lane) ? task.lane : 'triage',
    priority: task.priority,
    title: task.title,
    description: task.description,
    tag: task.tag,
    assignee: task.assignee,
    agent: task.agent,
    tenant: task.tenant,
    position: task.position,
    externalId: task.externalId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function readLinearSymphonyConfigured(): boolean {
  return Boolean(process.env.LINEAR_API_KEY && process.env.HERMES_ENABLE_LINEAR_SYMPHONY_KANBAN === '1');
}

export async function getKanbanSummary(modeInput?: unknown): Promise<KanbanSummary> {
  const mode = normalizeMode(modeInput);
  const linearConfigured = readLinearSymphonyConfigured();
  const effectiveMode = mode === 'linear_symphony' && !linearConfigured ? 'local' : mode;

  const [tasks, agents] = await Promise.all([
    taskRepo().find({
      where: { source: effectiveMode },
      order: { boardId: 'ASC', lane: 'ASC', position: 'ASC', updatedAt: 'DESC' },
    }),
    AppDataSource.getRepository(Agent).find({ order: { name: 'ASC' } }),
  ]);

  const counts = new Map<string, { name: string; count: number }>();
  counts.set(DEFAULT_BOARD_ID, { name: DEFAULT_BOARD_NAME, count: 0 });
  tasks.forEach((task) => {
    const current = counts.get(task.boardId) ?? { name: task.boardName || task.boardId, count: 0 };
    current.count += 1;
    counts.set(task.boardId, current);
  });

  const tenants = [...new Set(['core', ...tasks.map((task) => task.tenant).filter(Boolean)])].sort();

  return {
    mode: effectiveMode,
    availableModes: [
      {
        id: 'local',
        label: 'Local',
        enabled: true,
        description: 'Hermes Client local Kanban stored in the local SQLite database.',
      },
      {
        id: 'linear_symphony',
        label: 'Linear / Symphony',
        enabled: linearConfigured,
        description: linearConfigured
          ? 'Linear/Symphony adapter is configured.'
          : 'Adapter boundary is present; set LINEAR_API_KEY and HERMES_ENABLE_LINEAR_SYMPHONY_KANBAN=1 to enable.',
      },
    ],
    boards: [...counts.entries()].map(([id, value]) => ({ id, name: value.name, count: value.count })),
    lanes: KANBAN_LANES,
    tasks: tasks.map(toResponse),
    profiles: agents.map((agent) => ({ id: agent.hermesProfile, name: agent.name })),
    tenants,
    linearSymphony: {
      configured: linearConfigured,
      message: linearConfigured
        ? 'Linear/Symphony mode is available.'
        : 'Linear/Symphony mode is not enabled in this local API yet.',
    },
  };
}

export async function createKanbanTask(input: KanbanCreateTaskBody): Promise<KanbanTaskResponse> {
  const title = readString(input.title);
  if (!title) throw new Error('title required');

  const now = new Date();
  const task = taskRepo().create({
    id: generateTaskId(),
    source: 'local',
    boardId: readString(input.boardId, DEFAULT_BOARD_ID),
    boardName: readString(input.boardName, DEFAULT_BOARD_NAME),
    lane: isLane(input.lane) ? input.lane : 'triage',
    priority: normalizePriority(input.priority),
    title,
    description: readString(input.description),
    tag: readString(input.tag, 'task'),
    assignee: input.assignee === null ? null : readString(input.assignee, '') || null,
    agent: input.agent === null ? null : readString(input.agent, '') || null,
    tenant: readString(input.tenant, 'core'),
    position: Date.now(),
    externalId: null,
    createdAt: now,
    updatedAt: now,
  });
  return toResponse(await taskRepo().save(task));
}

export async function updateKanbanTask(id: string, input: KanbanUpdateTaskBody): Promise<KanbanTaskResponse | null> {
  const repo = taskRepo();
  const task = await repo.findOne({ where: { id } });
  if (!task) return null;

  if (input.title !== undefined) task.title = readString(input.title, task.title);
  if (input.description !== undefined) task.description = readString(input.description);
  if (input.boardId !== undefined) task.boardId = readString(input.boardId, task.boardId);
  if (input.boardName !== undefined) task.boardName = readString(input.boardName, task.boardName);
  if (input.lane !== undefined && isLane(input.lane)) task.lane = input.lane;
  if (input.priority !== undefined) task.priority = normalizePriority(input.priority);
  if (input.tag !== undefined) task.tag = readString(input.tag, task.tag);
  if (input.assignee !== undefined) task.assignee = input.assignee === null ? null : readString(input.assignee, '') || null;
  if (input.agent !== undefined) task.agent = input.agent === null ? null : readString(input.agent, '') || null;
  if (input.tenant !== undefined) task.tenant = readString(input.tenant, task.tenant);
  if (typeof input.position === 'number' && Number.isFinite(input.position)) task.position = input.position;
  task.updatedAt = new Date();

  return toResponse(await repo.save(task));
}

export async function deleteKanbanTask(id: string): Promise<boolean> {
  const result = await taskRepo().delete({ id, source: 'local' });
  return Boolean(result.affected);
}

export async function nudgeKanbanDispatcher(boardId = DEFAULT_BOARD_ID) {
  const readyTasks = await taskRepo().find({
    where: { source: 'local', boardId, lane: 'ready' },
    order: { priority: 'ASC', position: 'ASC' },
  });
  if (readyTasks.length === 0) {
    return { ok: false, error: 'no ready tasks' };
  }

  const taskLines = readyTasks
    .map((task) => `- ${task.id} [${task.priority}] ${task.title}${task.assignee ? ` -> ${task.assignee}` : ''}`)
    .join('\n');
  const goal = [
    `Dispatch the ready Kanban tasks from board "${boardId}".`,
    '',
    'Use Neo as orchestrator. Delegate to Trinity, Morpheus, and Oracle as needed.',
    'Ready tasks:',
    taskLines,
  ].join('\n');

  return launchWorkspaceSwarmMission({
    goal,
    maxParallel: Math.min(readyTasks.length, 3),
    supervised: false,
  });
}
