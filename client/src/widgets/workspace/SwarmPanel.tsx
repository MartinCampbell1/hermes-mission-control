import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  FileDownloadOutlined,
  LayersOutlined,
  MoreVert,
  PauseOutlined,
  RefreshOutlined,
  RocketLaunchOutlined,
  SettingsOutlined,
} from '@mui/icons-material';
import {
  useGetWorkspaceSwarmQuery,
  useLaunchWorkspaceSwarmMutation,
  type WorkspaceSwarmArtifact,
  type WorkspaceSwarmLaunchResponse,
  type WorkspaceSwarmMission,
  type WorkspaceSwarmRoleLane,
  type WorkspaceSwarmSummary,
  type WorkspaceSwarmWorker,
} from '../../entities/workspace';
import {
  buildWorkspaceSwarmLaunchRequest,
  FALLBACK_WORKSPACE_SWARM_DEFAULTS,
  formStateFromDefaults,
  formatWorkspaceSwarmDate,
  type SwarmLaunchFormState,
} from './model/swarmLaunchForm';
import { useI18n } from '../../shared/i18n';

type TFunction = ReturnType<typeof useI18n>['t'];
type TabId = 'overview' | 'missions' | 'workers' | 'timeline' | 'artifacts';

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'missions', label: 'Missions' },
  { id: 'workers', label: 'Workers' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'artifacts', label: 'Artifacts' },
];

function apiErrorMessage(error: unknown, t: TFunction): string {
  const data = (error as { data?: { error?: string; raw?: string } })?.data;
  return data?.error || data?.raw || t('workspace.launchError');
}

function statusTone(status: string | null | undefined): 'ok' | 'warn' | 'err' | 'muted' {
  const value = (status ?? '').toLowerCase();
  if (!value) return 'muted';
  if (/(error|fail|blocked|cancel)/.test(value)) return 'err';
  if (/(warn|pause|stale)/.test(value)) return 'warn';
  if (/(queue|pending|idle|not_found|unavailable)/.test(value)) return 'muted';
  return 'ok';
}

function StatusPill({ status, pulse = false }: { status: string | null | undefined; pulse?: boolean }) {
  if (!status) return null;
  const tone = statusTone(status);
  const className = tone === 'ok' ? 'status-pill' : `status-pill ${tone}`;
  return (
    <span className={className}>
      {pulse && tone === 'ok' ? <span className="pulse" /> : null}
      {status}
    </span>
  );
}

function timeValue(updatedAt: string | null | undefined): number {
  if (!updatedAt) return 0;
  const value = new Date(updatedAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

function relativeTime(updatedAt: string | null | undefined): string {
  const value = timeValue(updatedAt);
  if (!value) return 'pending';
  const minutes = Math.max(1, Math.round((Date.now() - value) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function workerProgress(worker: WorkspaceSwarmWorker): number {
  const value = worker.status.toLowerCase();
  if (/(done|complete|success)/.test(value)) return 100;
  if (/(running|active|working|live)/.test(value)) return 72;
  if (/(queue|pending|idle)/.test(value)) return 24;
  if (/(error|fail|blocked|cancel)/.test(value)) return 12;
  return 45;
}

function EmptySection({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-note">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function RuntimeError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="notice err">{error}</div>;
}

function MetricsRow({ data }: { data: WorkspaceSwarmSummary }) {
  const activeMissions = data.missions.filter((mission) =>
    /(running|active|queued|pending|scheduled)/i.test(mission.status)
  ).length;
  const activeWorkers = data.workers.filter((worker) =>
    /(running|active|working|live)/i.test(worker.status)
  ).length;
  const lastUpdated = [...data.missions, ...data.workers, ...data.artifacts]
    .map((item) => timeValue(item.updatedAt))
    .sort((left, right) => right - left)[0];

  const items = [
    { lbl: 'Active missions', val: String(activeMissions), delta: `${data.missions.length} total` },
    { lbl: 'Workers', val: `${activeWorkers} / ${data.workers.length}`, delta: `${data.roleLanes.length} role lanes` },
    { lbl: 'Artifacts', val: String(data.artifacts.length), delta: data.source },
    { lbl: 'Runtime', val: data.available ? 'online' : 'offline', delta: lastUpdated ? relativeTime(new Date(lastUpdated).toISOString()) : 'no state yet' },
  ];

  return (
    <div className="metrics-row">
      {items.map((metric) => (
        <div key={metric.lbl} className="metric">
          <span className="lbl">{metric.lbl}</span>
          <span className="val">{metric.val}</span>
          <span className="delta">{metric.delta}</span>
        </div>
      ))}
    </div>
  );
}

function LaunchResult({ launch, t }: { launch: WorkspaceSwarmLaunchResponse; t: TFunction }) {
  const scheduleText = launch.scheduleAt?.match(/^\d+m$/)
    ? t('workspace.cronIn', { time: launch.scheduleAt })
    : launch.scheduleAt
      ? t('workspace.cronAt', { time: formatWorkspaceSwarmDate(launch.scheduleAt) })
      : t('workspace.cronPending');

  return (
    <div className="notice ok">
      <strong>{t('workspace.missionScheduled', { job: launch.jobName ?? '' })}</strong>
      <span>
        {scheduleText}
        {launch.sessionKeyPrefix ? ` · ${launch.sessionKeyPrefix}` : ''}
      </span>
    </div>
  );
}

function RoleLaneList({ roleLanes, t }: { roleLanes: WorkspaceSwarmRoleLane[]; t: TFunction }) {
  if (!roleLanes.length) {
    return (
      <EmptySection
        title={t('workspace.noRoleLanes')}
        detail={t('workspace.noRoleLanesDetail')}
      />
    );
  }

  return (
    <div className="role-lane-grid">
      {roleLanes.map((role) => (
        <div key={role.id} className="role-lane">
          <div className="agent-avatar accent">{role.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <div className="pri">{role.name}</div>
            <div className="sec">{role.role}</div>
            <div className="role-desc">{role.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MissionList({ missions, t }: { missions: WorkspaceSwarmMission[]; t: TFunction }) {
  if (!missions.length) {
    return (
      <EmptySection
        title={t('workspace.noMissions')}
        detail={t('workspace.noMissionsDetail')}
      />
    );
  }

  return (
    <div>
      {missions.map((mission) => (
        <div key={mission.id} className="mission-row">
          <div>
            <div className="goal">{mission.title}</div>
            <div className="sub">
              {mission.id} · {relativeTime(mission.updatedAt)}
            </div>
            <RuntimeError error={mission.error} />
          </div>
          <StatusPill status={mission.status} pulse={/(running|active)/i.test(mission.status)} />
          <button className="icon-btn" title={t('common.details')}>
            <MoreVert />
          </button>
        </div>
      ))}
    </div>
  );
}

function WorkerCards({ workers, t }: { workers: WorkspaceSwarmWorker[]; t: TFunction }) {
  if (!workers.length) {
    return (
      <EmptySection
        title={t('workspace.noWorkers')}
        detail={t('workspace.noWorkersDetail')}
      />
    );
  }

  return (
    <>
      {workers.map((worker) => {
        const progress = workerProgress(worker);
        return (
          <div key={worker.id} className="worker-card">
            <div className="worker-hd">
              <StatusPill status={worker.status} pulse={/(running|active|working|live)/i.test(worker.status)} />
              <span className="name">{worker.name}</span>
              <span className="id">· {worker.id}</span>
              <span className="worker-updated">{relativeTime(worker.updatedAt)}</span>
            </div>
            <div className="worker-task">{worker.role ?? t('workspace.workerModel')}</div>
            <div className={`bar ${progress === 100 ? 'ok' : ''}`}>
              <i style={{ width: `${progress}%` }} />
            </div>
            <div className="worker-foot">
              <span>role: <code>{worker.role ?? 'worker'}</code></span>
              <span>{progress}%</span>
            </div>
            <RuntimeError error={worker.error} />
          </div>
        );
      })}
    </>
  );
}

function ArtifactList({ artifacts, t }: { artifacts: WorkspaceSwarmArtifact[]; t: TFunction }) {
  if (!artifacts.length) {
    return (
      <EmptySection
        title={t('workspace.noArtifacts')}
        detail={t('workspace.noArtifactsDetail')}
      />
    );
  }

  return (
    <div className="list">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="list-row">
          <FileDownloadOutlined />
          <div className="grow">
            <div className="pri">{artifact.title}</div>
            <div className="sec">
              {artifact.path || artifact.id} · {relativeTime(artifact.updatedAt)}
            </div>
            <RuntimeError error={artifact.error} />
          </div>
          <StatusPill status={artifact.status} />
          <button className="icon-btn" title={t('common.details')}>
            <MoreVert />
          </button>
        </div>
      ))}
    </div>
  );
}

function Timeline({ data }: { data: WorkspaceSwarmSummary }) {
  const items = useMemo(() => {
    const missionItems = data.missions.map((mission) => ({
      id: `mission-${mission.id}`,
      time: mission.updatedAt,
      what: `${mission.title} · ${mission.status}`,
      state: /(running|active)/i.test(mission.status) ? 'active' : statusTone(mission.status) === 'err' ? 'err' : 'ok',
    }));
    const workerItems = data.workers.map((worker) => ({
      id: `worker-${worker.id}`,
      time: worker.updatedAt,
      what: `${worker.name} · ${worker.status}`,
      state: /(running|active|working|live)/i.test(worker.status) ? 'active' : statusTone(worker.status) === 'err' ? 'err' : 'ok',
    }));
    const artifactItems = data.artifacts.map((artifact) => ({
      id: `artifact-${artifact.id}`,
      time: artifact.updatedAt,
      what: `${artifact.title} · ${artifact.status ?? 'artifact'}`,
      state: statusTone(artifact.status) === 'err' ? 'err' : 'ok',
    }));

    return [...missionItems, ...workerItems, ...artifactItems]
      .sort((left, right) => timeValue(right.time) - timeValue(left.time))
      .slice(0, 16);
  }, [data.artifacts, data.missions, data.workers]);

  if (!items.length) {
    return <EmptySection title="No activity yet" detail="Hermes Cron and Workspace runtime events will appear here after a mission runs." />;
  }

  return (
    <div className="timeline">
      {items.map((item) => (
        <div key={item.id} className="timeline-item" data-state={item.state}>
          <div className="when">{relativeTime(item.time)}</div>
          <div className="what">{item.what}</div>
        </div>
      ))}
    </div>
  );
}

export default function SwarmPanel() {
  const { t } = useI18n();
  const { data, isLoading, isFetching, isError, refetch } = useGetWorkspaceSwarmQuery();
  const [launchWorkspaceSwarm, { isLoading: isLaunching }] = useLaunchWorkspaceSwarmMutation();
  const [form, setForm] = useState<SwarmLaunchFormState>(() =>
    formStateFromDefaults(FALLBACK_WORKSPACE_SWARM_DEFAULTS)
  );
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [lastLaunch, setLastLaunch] = useState<WorkspaceSwarmLaunchResponse | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!data?.launchDefaults || defaultsApplied) return;
    setForm(formStateFromDefaults(data.launchDefaults));
    setDefaultsApplied(true);
  }, [data?.launchDefaults, defaultsApplied]);

  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return undefined;
    }
    const id = window.setTimeout(() => setLoadingTimedOut(true), 3000);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  const updateField = <K extends keyof SwarmLaunchFormState>(
    field: K,
    value: SwarmLaunchFormState[K]
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleLaunch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.goal.trim()) return;
    setLaunchError('');
    setLastLaunch(null);
    try {
      const result = await launchWorkspaceSwarm(buildWorkspaceSwarmLaunchRequest(form)).unwrap();
      setLastLaunch(result);
      setForm((current) => ({ ...current, goal: '' }));
      refetch();
    } catch (error) {
      setLaunchError(apiErrorMessage(error, t));
    }
  };

  if (isLoading && !loadingTimedOut) {
    return (
      <div className="page">
        <div className="page-inner">
          <div className="notice">{t('workspace.loading')}</div>
        </div>
      </div>
    );
  }

  const fallbackData: WorkspaceSwarmSummary = {
    available: false,
    source: 'not_found',
    note: t('workspace.loadError'),
    missions: [],
    workers: [],
    artifacts: [],
    launchDefaults: FALLBACK_WORKSPACE_SWARM_DEFAULTS,
    roleLanes: [],
  };
  const summary = data ?? fallbackData;
  const defaults = summary.launchDefaults;
  const canLaunch = form.goal.trim().length > 0 && !isLaunching;

  return (
    <>
      <div className="topbar">
        <div className="title-block">
          <RocketLaunchOutlined style={{ width: 18, height: 18, color: 'var(--accent)' }} />
          <h1>{t('workspace.title')}</h1>
          <StatusPill
            status={summary.available ? t('workspace.runtimeFound') : t('workspace.runtimeUnavailable')}
            pulse={summary.available}
          />
          {isFetching ? <StatusPill status={t('workspace.refreshing')} /> : null}
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => refetch()} disabled={isFetching} title={t('workspace.refreshTitle')}>
            <RefreshOutlined />
          </button>
          <button className="icon-btn" title={t('chat.sessionSettings')}>
            <SettingsOutlined />
          </button>
        </div>
      </div>

      <div className="page">
        <div className="page-inner">
          <div className="page-hd">
            <p>{t('workspace.description')}</p>
          </div>

          <MetricsRow data={summary} />
          {(isError || !data) ? (
            <div className="notice err">
              <strong>{t('workspace.loadError')}</strong>
              <button className="btn ghost sm" onClick={() => refetch()}>{t('common.retry')}</button>
            </div>
          ) : null}

          <div className="tabs">
            {tabs.map((item) => (
              <button
                key={item.id}
                className="tab"
                data-active={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <>
              <div className="card">
                <div className="card-hd">
                  <div>
                    <h3>{t('workspace.launchMission')}</h3>
                    <p>{t('workspace.outputRoot', { dir: form.projectsDir || defaults.projectsDir })}</p>
                  </div>
                  <button className="btn ghost" type="button">
                    <LayersOutlined />
                    <span>Templates</span>
                  </button>
                </div>
                <form onSubmit={handleLaunch}>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label>{t('workspace.missionGoal')}</label>
                    <textarea
                      aria-label={t('workspace.missionGoal')}
                      value={form.goal}
                      onChange={(event) => updateField('goal', event.target.value)}
                      placeholder={t('workspace.missionGoal')}
                    />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>{t('workspace.parallelWorkers')}</label>
                      <select value={form.maxParallel} onChange={(event) => updateField('maxParallel', event.target.value)}>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={String(value)}>{value}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>{t('workspace.profile')}</label>
                      <input
                        value={form.profile}
                        onChange={(event) => updateField('profile', event.target.value)}
                        placeholder={defaults.profile || t('common.default')}
                      />
                    </div>
                    <div className="mission-actions">
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={form.supervised}
                          onChange={(event) => updateField('supervised', event.target.checked)}
                        />
                        {t('workspace.supervised')}
                      </label>
                      <button className="btn" type="submit" disabled={!canLaunch}>
                        <RocketLaunchOutlined />
                        <span>{isLaunching ? t('common.saving') : t('workspace.launch')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="field-row mission-field-row">
                    <div className="field">
                      <label>{t('workspace.workdir')}</label>
                      <input
                        value={form.workdir}
                        onChange={(event) => updateField('workdir', event.target.value)}
                        placeholder={defaults.workdir}
                      />
                    </div>
                    <div className="field">
                      <label>{t('workspace.projectsDir')}</label>
                      <input
                        value={form.projectsDir}
                        onChange={(event) => updateField('projectsDir', event.target.value)}
                        placeholder={defaults.projectsDir}
                      />
                    </div>
                    <div className="field">
                      <label>{t('workspace.orchestratorModel')}</label>
                      <input
                        value={form.orchestratorModel}
                        onChange={(event) => updateField('orchestratorModel', event.target.value)}
                        placeholder={defaults.orchestratorModel || t('workspace.backendDefault')}
                      />
                    </div>
                  </div>
                  <div className="field-row mission-field-row mission-field-row-short">
                    <div className="field">
                      <label>{t('workspace.workerModel')}</label>
                      <input
                        value={form.workerModel}
                        onChange={(event) => updateField('workerModel', event.target.value)}
                        placeholder={defaults.workerModel || t('workspace.backendDefault')}
                      />
                    </div>
                  </div>
                  {launchError ? <div className="notice err">{launchError}</div> : null}
                  {lastLaunch ? <LaunchResult launch={lastLaunch} t={t} /> : null}
                </form>
              </div>

              <div className="swarm-grid">
                <div className="card">
                  <div className="card-hd">
                    <h3>{t('workspace.workers')} · {summary.workers.length}</h3>
                    <button className="btn ghost" type="button">
                      <PauseOutlined />
                      <span>Pause all</span>
                    </button>
                  </div>
                  <WorkerCards workers={summary.workers} t={t} />
                </div>

                <div className="card">
                  <div className="card-hd">
                    <h3>Activity</h3>
                    <span className="card-meta">runtime state</span>
                  </div>
                  <Timeline data={summary} />
                </div>
              </div>

              <div className="card">
                <div className="card-hd">
                  <h3>{t('workspace.controlledAgents')}</h3>
                </div>
                <RoleLaneList roleLanes={summary.roleLanes} t={t} />
              </div>

              {summary.note ? (
                <div className={`notice ${summary.available ? 'warn' : ''}`}>{summary.note}</div>
              ) : null}
            </>
          ) : null}

          {tab === 'missions' ? <MissionList missions={summary.missions} t={t} /> : null}

          {tab === 'workers' ? (
            <div className="card">
              <div className="card-hd">
                <h3>{t('workspace.workers')}</h3>
              </div>
              <WorkerCards workers={summary.workers} t={t} />
            </div>
          ) : null}

          {tab === 'timeline' ? (
            <div className="card">
              <div className="card-hd">
                <h3>Full activity log</h3>
              </div>
              <Timeline data={summary} />
            </div>
          ) : null}

          {tab === 'artifacts' ? <ArtifactList artifacts={summary.artifacts} t={t} /> : null}
        </div>
      </div>
    </>
  );
}
