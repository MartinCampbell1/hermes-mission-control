import { useMemo, useState } from 'react';
import { Add, Refresh, RocketLaunch } from '@mui/icons-material';
import {
  useCreateKanbanTaskMutation,
  useGetKanbanQuery,
  useMoveKanbanTaskMutation,
  useNudgeKanbanDispatcherMutation,
  type KanbanLane,
  type KanbanLaneId,
  type KanbanTask,
} from '../../entities/kanban';
import { useI18n } from '../../shared/i18n';

const DEFAULT_LANES: KanbanLane[] = [
  { id: 'triage', name: 'Triage', hue: 255, description: 'Raw ideas - a specifier will flesh out the spec' },
  { id: 'todo', name: 'Todo', hue: 205, description: 'Waiting on dependencies or unassigned' },
  { id: 'ready', name: 'Ready', hue: 55, description: 'Assigned and waiting for a dispatcher tick' },
  { id: 'progress', name: 'In Progress', hue: 135, description: 'Claimed by a worker - in-flight' },
  { id: 'blocked', name: 'Blocked', hue: 350, description: 'Worker asked for human input' },
  { id: 'done', name: 'Done', hue: 190, description: 'Completed' },
];

function taskAge(task: KanbanTask): string {
  const updated = new Date(task.updatedAt).getTime();
  const minutes = Math.max(1, Math.round((Date.now() - updated) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function laneColor(hue: number): string {
  return `oklch(0.7 0.15 ${hue})`;
}

export default function KanbanPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<'local' | 'linear_symphony'>('local');
  const [board, setBoard] = useState('default');
  const [profile, setProfile] = useState('all');
  const [tenant, setTenant] = useState('all');
  const [lanesByProfile, setLanesByProfile] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [newTaskLane, setNewTaskLane] = useState<KanbanLaneId | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [nudgeMessage, setNudgeMessage] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState<KanbanTask[]>([]);
  const { data, isFetching, refetch } = useGetKanbanQuery({ mode });
  const [moveTask] = useMoveKanbanTaskMutation();
  const [createTask, { isLoading: creatingTask }] = useCreateKanbanTaskMutation();
  const [nudgeDispatcher, { isLoading: nudging }] = useNudgeKanbanDispatcherMutation();

  const rawBoards = data?.boards ?? [{ id: 'default', name: 'Default', count: 0 }];
  const lanes = data?.lanes?.length ? data.lanes : DEFAULT_LANES;
  const profiles = data?.profiles ?? [];
  const tenants = data?.tenants ?? ['core'];
  const tasks = useMemo(() => {
    const byId = new Map<string, KanbanTask>();
    [...(data?.tasks ?? []), ...localTasks].forEach((task) => byId.set(task.id, task));
    return Array.from(byId.values());
  }, [data?.tasks, localTasks]);
  const boards = useMemo(() => {
    const boardMap = new Map(rawBoards.map((item) => [item.id, { ...item, count: 0 }]));
    tasks.forEach((task) => {
      const current = boardMap.get(task.boardId) ?? {
        id: task.boardId,
        name: task.boardName || task.boardId,
        count: 0,
      };
      boardMap.set(task.boardId, { ...current, count: current.count + 1 });
    });
    return Array.from(boardMap.values());
  }, [rawBoards, tasks]);
  const visible = useMemo(() => {
    return tasks.filter((task) => {
      if (board !== 'all' && task.boardId !== board) return false;
      if (profile !== 'all' && (task.agent || '').toLowerCase() !== profile) return false;
      if (tenant !== 'all' && task.tenant !== tenant) return false;
      return true;
    });
  }, [board, profile, tasks, tenant]);

  const byLane = (lane: KanbanLaneId) => visible.filter((task) => task.lane === lane);

  const handleDrop = async (lane: KanbanLaneId) => {
    if (!draggingId) return;
    setDraggingId(null);
    const movedId = draggingId;
    setLocalTasks((current) => {
      const existing = tasks.find((task) => task.id === movedId);
      const next = existing ? { ...existing, lane, updatedAt: new Date().toISOString() } : null;
      const updated = current.map((task) => task.id === movedId ? { ...task, lane, updatedAt: new Date().toISOString() } : task);
      return next && !current.some((task) => task.id === movedId) ? [...updated, next] : updated;
    });
    try {
      await moveTask({ id: movedId, lane, position: Date.now() }).unwrap();
    } catch {
      setLocalTasks((current) => current.filter((task) => task.id !== movedId));
      setNudgeMessage(t('kanban.moveFailed'));
    }
  };

  const submitTask = async (lane: KanbanLaneId) => {
    const title = newTaskTitle.trim();
    if (!title) return;
    const boardId = board === 'all' ? 'default' : board;
    const boardName = boards.find((item) => item.id === boardId)?.name ?? 'Default';
    const tempId = `T_TMP_${Date.now().toString(36).toUpperCase()}`;
    const optimisticTask: KanbanTask = {
      id: tempId,
      source: mode,
      boardId,
      boardName,
      lane,
      priority: 'P3',
      title,
      description: '',
      tag: 'task',
      assignee: profile === 'all' ? null : profile,
      agent: profile === 'all' ? null : profile,
      tenant: tenant === 'all' ? 'core' : tenant,
      position: Date.now(),
      externalId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setLocalTasks((current) => [...current, optimisticTask]);
    setNudgeMessage(t('kanban.taskAdded', { id: tempId }));
    setNewTaskTitle('');
    setNewTaskLane(null);
    try {
      const result = await createTask({
        title,
        lane,
        boardId,
        boardName,
        tenant: tenant === 'all' ? 'core' : tenant,
        agent: profile === 'all' ? null : profile,
        assignee: profile === 'all' ? null : profile,
        tag: 'task',
        priority: 'P3',
      }).unwrap();
      setLocalTasks((current) => [
        ...current.filter((task) => task.id !== tempId && task.id !== result.task.id),
        result.task,
      ]);
      setNudgeMessage(t('kanban.taskAdded', { id: result.task.id }));
    } catch {
      setLocalTasks((current) => current.filter((task) => task.id !== tempId));
      setNudgeMessage(t('kanban.addFailed'));
    }
  };

  const moveFromSelect = async (task: KanbanTask, lane: KanbanLaneId) => {
    if (task.lane === lane) return;
    setLocalTasks((current) => {
      const next = { ...task, lane, updatedAt: new Date().toISOString() };
      const updated = current.map((item) => item.id === task.id ? next : item);
      return current.some((item) => item.id === task.id) ? updated : [...updated, next];
    });
    try {
      await moveTask({ id: task.id, lane, position: Date.now() }).unwrap();
    } catch {
      setLocalTasks((current) => current.map((item) => item.id === task.id ? task : item));
      setNudgeMessage(t('kanban.moveFailed'));
    }
  };

  const nudge = async () => {
    setNudgeMessage(null);
    try {
      const result = await nudgeDispatcher({ boardId: board === 'all' ? 'default' : board, mode }).unwrap();
      setNudgeMessage(result.ok ? t('kanban.dispatcherScheduled', { job: result.jobName ?? 'Hermes cron' }) : result.error ?? t('kanban.dispatcherFailed'));
    } catch (error) {
      const message = error && typeof error === 'object' && 'data' in error
        ? ((error as { data?: { error?: string } }).data?.error ?? 'Dispatcher failed')
        : t('kanban.dispatcherFailed');
      setNudgeMessage(message);
    }
  };

  return (
    <div className="main">
      <div className="page-hd">
        <div>
          <h1>Kanban</h1>
          <p className="subtle">Drag tasks across lanes. Filter by profile, tenant, or board.</p>
        </div>
        <div className="hd-actions">
          <button className="btn ghost" onClick={() => refetch()} disabled={isFetching}>
            <Refresh />
            <span>{isFetching ? t('kanban.refreshing') : t('kanban.refresh')}</span>
          </button>
          <button className="btn primary" onClick={() => setNewTaskLane('triage')}>
            <Add />
            <span>{t('kanban.newTask')}</span>
          </button>
        </div>
      </div>

      <div className="kb-bar">
        <div className="kb-field">
          <label>Mode</label>
          <select value={mode} onChange={(event) => setMode(event.target.value as 'local' | 'linear_symphony')}>
            {(data?.availableModes ?? [{ id: 'local', label: 'Local', enabled: true }]).map((item) => (
              <option key={item.id} value={item.id} disabled={!item.enabled && item.id !== 'local'}>
                {item.label}{item.enabled ? '' : ' · not configured'}
              </option>
            ))}
          </select>
        </div>
        <div className="kb-field">
          <label>Board</label>
          <select value={board} onChange={(event) => setBoard(event.target.value)}>
            {boards.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.count}</option>
            ))}
          </select>
        </div>
        <div className="kb-field">
          <label>Profile</label>
          <select value={profile} onChange={(event) => setProfile(event.target.value)}>
            <option value="all">All profiles</option>
            {profiles.map((item) => (
              <option key={item.id} value={item.name.toLowerCase()}>{item.name}</option>
            ))}
          </select>
        </div>
        <div className="kb-field">
          <label>Tenant</label>
          <select value={tenant} onChange={(event) => setTenant(event.target.value)}>
            <option value="all">All tenants</option>
            {tenants.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <label className="kb-check">
          <input type="checkbox" checked={lanesByProfile} onChange={(event) => setLanesByProfile(event.target.checked)} />
          <span>Lanes by profile</span>
        </label>
        <div className="kb-spacer" />
        <button className="btn ghost" onClick={nudge} disabled={nudging}>
          <RocketLaunch />
          <span>{nudging ? 'Nudging...' : 'Nudge dispatcher'}</span>
        </button>
        <span className="kb-count">{visible.length} tasks</span>
      </div>
      {nudgeMessage ? <div className="kb-mode-note">{nudgeMessage}</div> : null}
      {data?.linearSymphony.configured === false ? <div className="kb-mode-note">{data.linearSymphony.message}</div> : null}

      <div className="kb-board" data-lanes-by-profile={lanesByProfile}>
        {lanes.map((lane) => {
          const items = byLane(lane.id);
          return (
            <div
              key={lane.id}
              className="kb-lane"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => void handleDrop(lane.id)}
            >
              <div className="kb-lane-hd">
                <span className="lane-dot" style={{ background: laneColor(lane.hue) }} />
                <span className="kb-lane-name">{lane.name}</span>
                <span className="kb-lane-count">{items.length}</span>
                <button className="icon-btn" onClick={() => setNewTaskLane(lane.id)}>
                  <Add />
                </button>
              </div>
              <div className="kb-lane-desc">{lane.description}</div>
              {newTaskLane === lane.id ? (
                <div className="kb-card kb-new-card">
                  <input
                    autoFocus
                    value={newTaskTitle}
                    onChange={(event) => setNewTaskTitle(event.target.value)}
                    placeholder="Task title"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void submitTask(lane.id);
                      if (event.key === 'Escape') setNewTaskLane(null);
                    }}
                  />
                  <div className="pc-actions">
                    <button className="btn primary sm" onClick={() => void submitTask(lane.id)} disabled={creatingTask}>
                      Add
                    </button>
                    <button className="btn ghost sm" onClick={() => setNewTaskLane(null)}>Cancel</button>
                  </div>
                </div>
              ) : null}
              <div className="kb-lane-list">
                {items.length === 0 && <div className="kb-empty">— no tasks —</div>}
                {items.map((task) => (
                  <div
                    key={task.id}
                    className="kb-card"
                    draggable
                    onDragStart={() => setDraggingId(task.id)}
                    onDragEnd={() => setDraggingId(null)}
                  >
                    <div className="kb-card-top">
                      <span className="kb-id">{task.id}</span>
                      <span className={`kb-pri pri-${task.priority}`}>{task.priority}</span>
                      <span className="kb-tag">{task.tag}</span>
                    </div>
                    <div className="kb-card-title">{task.title}</div>
                    <div className="kb-card-bot">
                      {task.assignee ? (
                        <span className="kb-assignee">
                          <span className="agent-avatar accent" style={{ width: 16, height: 16, fontSize: 8 }}>{task.assignee.slice(0, 1).toUpperCase()}</span>
                          <span>{task.assignee}</span>
                        </span>
                      ) : (
                        <span className="kb-assignee unassigned">@unassigned</span>
                      )}
                      <span className="kb-age">{taskAge(task)} ago</span>
                    </div>
                    <label className="kb-move">
                      <span>Move</span>
                      <select
                        aria-label={`Move ${task.title}`}
                        value={task.lane}
                        onChange={(event) => void moveFromSelect(task, event.target.value as KanbanLaneId)}
                      >
                        {lanes.map((targetLane) => (
                          <option key={targetLane.id} value={targetLane.id}>{targetLane.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
