import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-kanban-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Agent, User } = require('../../src/entities') as typeof import('../../src/entities');
const kanban = require('../../src/services/kanban/kanban') as typeof import('../../src/services/kanban/kanban');

test.before(async () => {
  fs.mkdirSync(process.env.HERMES_HOME!, { recursive: true });
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('local kanban starts with reference lanes and default board', async () => {
  const summary = await kanban.getKanbanSummary();

  assert.equal(summary.mode, 'local');
  assert.deepEqual(
    summary.lanes.map((lane) => lane.id),
    ['triage', 'todo', 'ready', 'progress', 'blocked', 'done']
  );
  assert.equal(summary.boards[0].id, 'default');
  assert.equal(summary.tasks.length, 0);
  assert.equal(summary.availableModes[1].id, 'linear_symphony');
  assert.equal(summary.availableModes[1].enabled, false);
});

test('tasks can be created and moved across reference lanes', async () => {
  const userRepo = AppDataSource.getRepository(User);
  const agentRepo = AppDataSource.getRepository(Agent);
  const user = await userRepo.save(
    userRepo.create({
      email: 'kanban@example.com',
      password: '123456',
      name: 'Kanban',
      lastName: 'Test',
      active: true,
      createdAt: new Date(),
    })
  );
  await agentRepo.save(
    agentRepo.create({
      name: 'Neo',
      hermesProfile: 'neo',
      createdBy: user._id,
      createdAt: new Date(),
    })
  );

  const task = await kanban.createKanbanTask({
    title: 'Dispatch donor shell migration',
    lane: 'ready',
    priority: 'P2',
    tag: 'impl',
    assignee: 'neo',
    agent: 'Neo',
  });

  assert.equal(task.lane, 'ready');
  assert.equal(task.priority, 'P2');

  const moved = await kanban.updateKanbanTask(task.id, { lane: 'progress', position: 10 });
  assert.equal(moved?.lane, 'progress');
  assert.equal(moved?.position, 10);

  const summary = await kanban.getKanbanSummary();
  assert.equal(summary.tasks.length, 1);
  assert.equal(summary.tasks[0].title, 'Dispatch donor shell migration');
  assert.equal(summary.profiles[0].id, 'neo');
});

test('linear/symphony mode falls back to local unless explicitly configured', async () => {
  const summary = await kanban.getKanbanSummary('linear_symphony');

  assert.equal(summary.mode, 'local');
  assert.equal(summary.linearSymphony.configured, false);
  assert.match(summary.linearSymphony.message, /not enabled/i);
});
