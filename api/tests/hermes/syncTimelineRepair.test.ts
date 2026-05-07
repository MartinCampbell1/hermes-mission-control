import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTimelineStateDb } from '../fixtures/stateDbTimelineFixture';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-sync-timeline-'));
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Agent, Conversation, Message } = require('../../src/entities') as typeof import('../../src/entities');
const sync = require('../../src/services/hermes/sync') as typeof import('../../src/services/hermes/sync');

test.before(async () => {
  fs.mkdirSync(process.env.HERMES_HOME!, { recursive: true });
  createTimelineStateDb(process.env.HERMES_HOME!);
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('sync repairs blank assistant rows into timeline events and hides orphan blanks', async () => {
  const agentRepo = AppDataSource.getRepository(Agent);
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);

  const agent = await agentRepo.save(
    agentRepo.create({
      name: 'default',
      hermesProfile: 'default',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      sessionKey: 'timeline-live',
      threadKey: 'timeline-thread',
      rootSessionKey: 'timeline-thread',
      messageSource: 'state_db',
      title: 'Timeline',
      createdBy: 1,
      createdAt: new Date(),
    })
  );

  const toolPlaceholder = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      externalId: 'timeline-live:11',
      text: '',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(102_000),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'Need date',
      role: 'user' as const,
      createdBy: 1,
      createdAt: new Date(101_000),
    })
  );
  const finalPlaceholder = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'The date is Thu Apr 30 05:00:00 WITA 2026.',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(106_000),
    })
  );
  const orphanBlank = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: '',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(120_000),
    })
  );

  const result = await sync.syncConversationFromHermes(conv, agent);
  const repairedTool = await msgRepo.findOneByOrFail({ _id: toolPlaceholder._id });
  const repairedFinal = await msgRepo.findOneByOrFail({ _id: finalPlaceholder._id });
  const repairedOrphan = await msgRepo.findOneByOrFail({ _id: orphanBlank._id });
  const all = await msgRepo.find({
    where: { conversationId: conv._id },
    order: { createdAt: 'ASC', _id: 'ASC' },
  });

  assert.equal(result.claimed, 2);
  assert.equal(repairedTool.role, 'tool');
  assert.equal(repairedTool.kind, 'tool_call');
  assert.equal(repairedTool.toolName, 'exec_command');
  assert.equal(repairedTool.toolStatus, 'done');
  assert.equal(repairedTool.hidden, false);
  assert.equal(repairedFinal.externalId, 'timeline-live:15');
  assert.equal(repairedFinal.kind, 'message');
  assert.equal(repairedOrphan.kind, 'status');
  assert.equal(repairedOrphan.hidden, true);
  assert.ok(all.some((message) => message.kind === 'tool_result' && message.toolName === 'exec_command'));
  assert.ok(all.some((message) => message.kind === 'reasoning' && message.thinking));
});

test('startup repair hides legacy blank assistant messages globally', async () => {
  const msgRepo = AppDataSource.getRepository(Message);
  const blank = await msgRepo.save(
    msgRepo.create({
      conversationId: 999,
      text: '',
      thinking: '',
      role: 'assistant' as const,
      kind: 'message' as const,
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const noisy = await msgRepo.save(
    msgRepo.create({
      conversationId: 999,
      text: 'generic: (6 user messages, 163 total messages) Visible answer',
      role: 'assistant' as const,
      kind: 'message' as const,
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const rawReasoning = await msgRepo.save(
    msgRepo.create({
      conversationId: 999,
      text: '┌─ Reasoning ──────────────────────────────────────────────────────────────────┐\ninternal reasoning box\n└──────────────────────────────────────────────────────────────────────────────┘',
      role: 'assistant' as const,
      kind: 'message' as const,
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const call = await msgRepo.save(
    msgRepo.create({
      conversationId: 999,
      text: 'Running exec_command',
      role: 'tool' as const,
      kind: 'tool_call' as const,
      toolName: 'exec_command',
      toolCallId: 'call-repair-1',
      toolStatus: 'running',
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: 999,
      text: 'tool output',
      role: 'tool' as const,
      kind: 'tool_result' as const,
      toolName: 'exec_command',
      toolCallId: 'call-repair-1',
      toolStatus: 'done',
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const noisyToolResult = await msgRepo.save(
    msgRepo.create({
      conversationId: 999,
      text: '↻ Resumed session abc "title" (6 user messages, 127 total messages)\ntool output',
      role: 'tool' as const,
      kind: 'tool_result' as const,
      toolName: 'exec_command',
      toolCallId: 'call-repair-2',
      toolStatus: 'done',
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: 999,
      text: 'Visible answer',
      role: 'assistant' as const,
      kind: 'message' as const,
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );

  const repaired = await sync.repairLegacyBlankAssistantMessages();
  const repairedBlank = await msgRepo.findOneByOrFail({ _id: blank._id });
  const repairedNoisy = await msgRepo.findOneByOrFail({ _id: noisy._id });
  const repairedReasoning = await msgRepo.findOneByOrFail({ _id: rawReasoning._id });
  const repairedCall = await msgRepo.findOneByOrFail({ _id: call._id });
  const repairedToolResult = await msgRepo.findOneByOrFail({ _id: noisyToolResult._id });

  assert.ok(repaired >= 5);
  assert.equal(repairedBlank.kind, 'status');
  assert.equal(repairedBlank.hidden, true);
  assert.equal(repairedBlank.metadata.hiddenReason, 'legacy_blank_assistant_startup_repair');
  assert.equal(repairedNoisy.text, 'Visible answer');
  assert.equal(repairedReasoning.kind, 'reasoning');
  assert.equal(repairedReasoning.text, '');
  assert.match(repairedReasoning.thinking || '', /internal reasoning box/);
  assert.equal(repairedCall.toolStatus, 'done');
  assert.equal(repairedToolResult.text, 'tool output');
});
