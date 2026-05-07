import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import type { Response } from 'express';
import { buildChatArgs } from '../../src/services/hermes/chat';
import {
  canUseGatewayForSession,
  selectSendAdapter,
  shouldUseGatewayAdapter,
  streamGatewayRun,
} from '../../src/services/hermes/gateway';
import { streamDryRun } from '../../src/services/hermes/mockStream';

interface MockSseResponse extends Response {
  chunks: string[];
  headers: Record<string, string>;
}

function createMockResponse(): MockSseResponse {
  const mock = {
    chunks: [] as string[],
    headers: {} as Record<string, string>,
    writableEnded: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    write(chunk: string) {
      this.chunks.push(chunk);
      return true;
    },
    flushHeaders() {
      return undefined;
    },
  };
  return mock as unknown as MockSseResponse;
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

const chatSourcePath = path.resolve(__dirname, '../../src/services/hermes/chat.ts');

function readChatSource(): string {
  return fs.readFileSync(chatSourcePath, 'utf8');
}

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('classic and api session ids use CLI resume args by default', () => {
  const classicArgs = buildChatArgs('hello', {
    sessionId: '20260429_010101_abcdef',
  });
  assert.deepEqual(classicArgs.slice(0, 6), ['chat', '-Q', '--source', 'hermes-client', '-q', 'hello']);
  assert.deepEqual(classicArgs.slice(-2), ['--resume', '20260429_010101_abcdef']);

  assert.equal(shouldUseGatewayAdapter('20260429_010101_abcdef'), false);
  assert.equal(shouldUseGatewayAdapter('api-legacy-thread'), false);

  const apiArgs = buildChatArgs('hello', {
    sessionId: 'api-legacy-thread',
  });
  assert.deepEqual(apiArgs.slice(-2), ['--resume', 'api-legacy-thread']);
});

test('api session gateway adapter remains available as explicit opt-in fallback', () => {
  withEnv('HERMES_API_SESSION_ADAPTER', 'gateway', () => {
    assert.equal(shouldUseGatewayAdapter('api-legacy-thread'), true);
  });
});

test('send adapter selection keeps classic sessions on CLI even when gateway probe is green', async () => {
  const probedSessionIds: string[] = [];
  const alwaysGreenGatewayProbe = async (opts: { sessionId: string | null }): Promise<boolean> => {
    probedSessionIds.push(opts.sessionId || '');
    return true;
  };

  assert.equal(
    await selectSendAdapter({
      dryRun: true,
      sessionId: 'api-existing-thread',
      canUseGateway: alwaysGreenGatewayProbe,
    }),
    'dry-run'
  );
  assert.deepEqual(probedSessionIds, []);

  assert.equal(
    await selectSendAdapter({
      dryRun: false,
      sessionId: '20260430_010101_classic',
      canUseGateway: alwaysGreenGatewayProbe,
    }),
    'cli'
  );
  assert.deepEqual(probedSessionIds, []);

  assert.equal(
    await selectSendAdapter({
      dryRun: false,
      sessionId: 'api-existing-thread',
      canUseGateway: alwaysGreenGatewayProbe,
    }),
    'cli'
  );
  assert.deepEqual(probedSessionIds, []);

  await withEnv('HERMES_API_SESSION_ADAPTER', 'gateway', async () => {
    assert.equal(
      await selectSendAdapter({
        dryRun: false,
        sessionId: 'api-existing-thread',
        canUseGateway: alwaysGreenGatewayProbe,
      }),
      'gateway'
    );
  });
  assert.deepEqual(probedSessionIds, ['api-existing-thread']);
});

test('gateway health probe is skipped for classic session lineage', async () => {
  let requestCount = 0;
  const server = http.createServer((_req, res) => {
    requestCount += 1;
    res.statusCode = 200;
    res.end('ok');
  });

  const upstream = await listen(server);
  try {
    assert.equal(
      await canUseGatewayForSession({
        upstream,
        sessionId: '20260430_010101_classic',
      }),
      false
    );
    assert.equal(requestCount, 0);

    await withEnv('HERMES_API_SESSION_ADAPTER', 'gateway', async () => {
      assert.equal(
        await canUseGatewayForSession({
          upstream,
          sessionId: 'api-existing-thread',
        }),
        true
      );
    });
    assert.equal(requestCount, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('CLI stream path has no foreground 120s state db wait or output holdback', () => {
  const source = readChatSource();
  assert.doesNotMatch(source, /STATE_DB_ASSISTANT_WAIT_MS/);
  assert.doesNotMatch(source, /waitForStateDbAssistantMessage/);
  assert.doesNotMatch(source, /holdOutputUntilClose/);
  assert.match(source, /sanitizeCliStreamChunk/);
});

test('new conversations use CLI args without resume target', () => {
  const args = buildChatArgs('hello', {});
  assert.equal(args.includes('--resume'), false);
});

test('CLI adapter maps only locally supported session settings to args', () => {
  const args = buildChatArgs('hello', {
    settings: {
      thinkingLevel: 'xhigh',
      reasoningLevel: 'high',
      verboseLevel: 'minimal',
      fastMode: true,
      modelOverride: 'openai-codex/gpt-5.5',
      providerOverride: 'openai-codex',
      skillsOverride: 'browser,computer',
      toolsetsOverride: 'shell,web',
    },
  });

  assert.equal(args.includes('--verbose'), true);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), [
    '--model',
    'openai-codex/gpt-5.5',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--provider'), args.indexOf('--provider') + 2), [
    '--provider',
    'openai-codex',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--toolsets'), args.indexOf('--toolsets') + 2), [
    '--toolsets',
    'shell,web',
  ]);
  assert.equal(args.filter((arg) => arg === '--skills').length, 2);
  assert.equal(args.includes('--thinking'), false);
  assert.equal(args.includes('--reasoning'), false);
  assert.equal(args.includes('--fast'), false);
});

test('CLI adapter omits inherited and disabled settings', () => {
  const args = buildChatArgs('hello', {
    settings: {
      thinkingLevel: null,
      reasoningLevel: 'inherit',
      verboseLevel: 'off',
      fastMode: null,
    },
  });

  assert.equal(args.includes('--verbose'), false);
  assert.equal(args.includes('--thinking'), false);
  assert.equal(args.includes('--reasoning'), false);
  assert.equal(args.includes('--fast'), false);
});

test('gateway adapter posts run, streams output deltas, and returns latest session id', async () => {
  let postedBody: Record<string, unknown> | null = null;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/runs') {
      postedBody = JSON.parse(await readRequestBody(req)) as Record<string, unknown>;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ run_id: 'run-1', session_id: 'api-old' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/runs/run-1/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write('data: {"type":"response.output_text.delta","delta":"hello "}\n\n');
      res.write('data: {"type":"response.output_text.delta","delta":"world"}\n\n');
      res.write('data: {"type":"response.completed","session_id":"api-new"}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  const upstream = await listen(server);
  try {
    const mockRes = createMockResponse();
    const result = await streamGatewayRun(mockRes, {
      upstream,
      sessionId: 'api-old',
      input: 'continue this',
      conversationHistory: [{ role: 'user', content: 'previous' }],
      settings: { thinkingLevel: 'xhigh', fastMode: true },
    });

    assert.deepEqual(postedBody, {
      input: 'continue this',
      session_id: 'api-old',
      conversation_history: [{ role: 'user', content: 'previous' }],
      settings: { thinkingLevel: 'xhigh', fastMode: true },
    });
    assert.equal(result.sessionId, 'api-new');
    assert.equal(result.text, 'hello world');
    assert.equal(
      mockRes.chunks.filter((chunk) => chunk.includes('response.output_text.delta')).length,
      2
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('gateway adapter strips split service tuple banners before forwarding deltas', async () => {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/runs') {
      await readRequestBody(req);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ run_id: 'run-1', session_id: 'api-old' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/runs/run-1/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write('data: {"type":"response.output_text.delta","delta":"\\"Old title\\r\\n"}\n\n');
      res.write('data: {"type":"response.output_text.delta","delta":"continued\\" (7 user messages, 24 \\r\\n"}\n\n');
      res.write('data: {"type":"response.output_text.delta","delta":"total messages)\\r\\nFinal"}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  const upstream = await listen(server);
  try {
    const mockRes = createMockResponse();
    const result = await streamGatewayRun(mockRes, {
      upstream,
      sessionId: 'api-old',
      input: 'continue this',
      conversationHistory: [],
    });

    const sse = mockRes.chunks.join('');
    assert.equal(result.text, 'Final');
    assert.match(sse, /Final/);
    assert.doesNotMatch(sse, /Old title/);
    assert.doesNotMatch(sse, /user messages/);
    assert.doesNotMatch(sse, /total messages/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('dry-run adapter emits settings.applied before output deltas', async () => {
  const mockRes = createMockResponse();
  const result = await streamDryRun(mockRes, 'qa settings', 'dry-existing', {
    thinkingLevel: 'xhigh',
    verboseLevel: 'minimal',
  });

  const sse = mockRes.chunks.join('');
  assert.equal(result.sessionId, 'dry-existing');
  assert.match(sse, /settings\.applied/);
  assert.ok(
    sse.indexOf('settings.applied') < sse.indexOf('response.output_text.delta'),
    'settings.applied should be emitted before output deltas'
  );
  assert.match(sse, /"thinkingLevel":"xhigh"/);
});
