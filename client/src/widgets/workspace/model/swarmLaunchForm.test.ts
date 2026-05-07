import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceSwarmLaunchRequest,
  formStateFromDefaults,
  formatWorkspaceSwarmDate,
  workspaceSwarmStatusColor,
} from './swarmLaunchForm';

describe('swarmLaunchForm', () => {
  it('hydrates launch form controls from backend defaults', () => {
    const form = formStateFromDefaults({
      profile: 'neo',
      projectsDir: '/tmp/projects',
      orchestratorModel: 'gpt-orchestrator',
      workerModel: 'gpt-worker',
      maxParallel: 4,
      supervised: true,
      workdir: '/repo',
    });

    expect(form).toMatchObject({
      goal: '',
      profile: 'neo',
      projectsDir: '/tmp/projects',
      orchestratorModel: 'gpt-orchestrator',
      workerModel: 'gpt-worker',
      maxParallel: '4',
      supervised: true,
      workdir: '/repo',
    });
  });

  it('builds a trimmed backend launch request without blank optional fields', () => {
    const request = buildWorkspaceSwarmLaunchRequest({
      goal: '  Ship controlled swarm  ',
      profile: '  ',
      projectsDir: ' /tmp/hermes ',
      orchestratorModel: ' gpt-orchestrator ',
      workerModel: '',
      maxParallel: '3',
      supervised: true,
      workdir: ' /repo ',
    });

    expect(request).toEqual({
      goal: 'Ship controlled swarm',
      projectsDir: '/tmp/hermes',
      orchestratorModel: 'gpt-orchestrator',
      maxParallel: 3,
      supervised: true,
      workdir: '/repo',
    });
  });

  it('omits invalid maxParallel values so the backend can apply its default', () => {
    const request = buildWorkspaceSwarmLaunchRequest({
      goal: 'Launch without numeric max parallel',
      profile: '',
      projectsDir: '/tmp',
      orchestratorModel: '',
      workerModel: '',
      maxParallel: '',
      supervised: false,
      workdir: '/repo',
    });

    expect(request).not.toHaveProperty('maxParallel');
  });

  it('maps runtime statuses to readable chip colors', () => {
    expect(workspaceSwarmStatusColor('executing')).toBe('info');
    expect(workspaceSwarmStatusColor('completed')).toBe('success');
    expect(workspaceSwarmStatusColor('failed')).toBe('error');
    expect(workspaceSwarmStatusColor('checkpoint')).toBe('warning');
    expect(workspaceSwarmStatusColor(null)).toBe('default');
  });

  it('keeps invalid timestamps visible instead of hiding runtime data', () => {
    expect(formatWorkspaceSwarmDate(null)).toBe('unknown');
    expect(formatWorkspaceSwarmDate('not-a-date')).toBe('not-a-date');
  });
});
