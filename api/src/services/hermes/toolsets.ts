import { execFileSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { hermesExec, HermesExecResult } from './cli';

export interface HermesToolsetInfo {
  name: string;
  description: string;
}

type ToolsetParseResult = { ok: boolean; toolsets: HermesToolsetInfo[] };

export type HermesToolsetRunner = (
  args: string[],
  opts: { timeoutMs: number }
) => HermesExecResult;

export type PythonToolsetRunner = () => string;

export interface ListToolsetsOptions {
  hermesRunner?: HermesToolsetRunner;
  pythonRunner?: PythonToolsetRunner;
}

const HERMES_AGENT_ROOT =
  process.env.HERMES_AGENT_ROOT || path.join(homedir(), '.hermes', 'hermes-agent');
const TOOLSET_TIMEOUT_MS = 3000;
const SAFE_TOOLSET_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSafeToolsetName(name: string): boolean {
  return name.length > 0 && name.length <= 80 && SAFE_TOOLSET_NAME.test(name);
}

function tryParseToolsetsJson(stdout: string): ToolsetParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (_error) {
    return { ok: false, toolsets: [] };
  }

  if (!Array.isArray(parsed)) return { ok: false, toolsets: [] };

  const seen = new Set<string>();
  const toolsets: HermesToolsetInfo[] = [];
  parsed.forEach((row) => {
    if (!isRecord(row)) return;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!isSafeToolsetName(name) || seen.has(name)) return;
    seen.add(name);
    toolsets.push({
      name,
      description: typeof row.description === 'string' ? row.description.trim() : '',
    });
  });

  return { ok: true, toolsets };
}

export function parseToolsetsJson(stdout: string): HermesToolsetInfo[] {
  return tryParseToolsetsJson(stdout).toolsets;
}

function runPythonToolsets(): string {
  const script = `
import json, sys
sys.path.insert(0, '${HERMES_AGENT_ROOT}')
from toolsets import get_all_toolsets
rows = []
for name, info in get_all_toolsets().items():
    description = info.get("description", "") if isinstance(info, dict) else getattr(info, "description", "")
    rows.append({"name": name, "description": description or ""})
print(json.dumps(rows))
`;

  return execFileSync('python3', ['-c', script], {
    encoding: 'utf-8',
    timeout: TOOLSET_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
}

export function listToolsets(options: ListToolsetsOptions = {}): HermesToolsetInfo[] {
  const hermesRunner = options.hermesRunner ?? hermesExec;
  const pythonRunner = options.pythonRunner ?? runPythonToolsets;

  const cliResult = hermesRunner(['toolsets', '--json'], { timeoutMs: TOOLSET_TIMEOUT_MS });
  if (cliResult.ok) {
    const parsed = tryParseToolsetsJson(cliResult.stdout);
    if (parsed.ok) return parsed.toolsets;
  }

  try {
    const parsed = tryParseToolsetsJson(pythonRunner());
    return parsed.ok ? parsed.toolsets : [];
  } catch (_error) {
    return [];
  }
}
