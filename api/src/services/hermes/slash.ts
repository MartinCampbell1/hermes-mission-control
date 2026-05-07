import { SlashCatalogItem, SlashResolveResult } from '../../@types/slash';
import { SkillInfo } from '../../@types/skill';
import { HermesToolsetInfo, listToolsets } from './toolsets';
import { listSkills } from './skills';

export interface BuildSlashCatalogOptions {
  profile?: string | null;
  skills?: SkillInfo[];
  toolsets?: HermesToolsetInfo[];
}

interface ParsedSlashInput {
  commandName: string;
  args: string;
}

const SAFE_COMMAND_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

interface CoreCommandDef {
  name: string;
  description: string;
  category: string;
  aliases?: string[];
  argsHint?: string | null;
  subcommands?: string[];
  executeMode?: SlashCatalogItem['executeMode'];
  source?: SlashCatalogItem['source'];
  settingKey?: string | null;
}

const CORE_COMMANDS: CoreCommandDef[] = [
  { name: 'help', description: 'Show available commands', category: 'Info', executeMode: 'local' },
  { name: 'new', description: 'Start a new Hermes session for this agent', category: 'Session', aliases: ['reset'], executeMode: 'local' },
  { name: 'clear', description: 'Clear the current composer draft and attachments', category: 'Session', executeMode: 'local' },
  { name: 'settings', description: 'Open or close the session settings bar', category: 'Configuration', source: 'local', executeMode: 'local' },
  { name: 'compact', description: 'Ask Hermes to compact and summarize this conversation context', category: 'Session', executeMode: 'local' },
  { name: 'retry', description: 'Retry the last message', category: 'Session' },
  { name: 'undo', description: 'Remove the last user/assistant exchange', category: 'Session' },
  { name: 'title', description: 'Set a title for the current session', category: 'Session', argsHint: '[name]' },
  { name: 'branch', description: 'Branch the current session', category: 'Session', aliases: ['fork'], argsHint: '[name]' },
  { name: 'compress', description: 'Manually compress conversation context', category: 'Session', argsHint: '[focus topic]' },
  { name: 'rollback', description: 'List or restore filesystem checkpoints', category: 'Session', argsHint: '[number]' },
  {
    name: 'snapshot',
    description: 'Create or restore state snapshots of Hermes config/state',
    category: 'Session',
    aliases: ['snap'],
    argsHint: '[create|restore <id>|prune]',
    subcommands: ['create', 'restore', 'prune'],
  },
  { name: 'stop', description: 'Kill all running background processes', category: 'Session' },
  { name: 'background', description: 'Run a prompt in the background', category: 'Session', aliases: ['bg'], argsHint: '<prompt>' },
  { name: 'btw', description: 'Ephemeral side question using session context', category: 'Session', argsHint: '<question>' },
  { name: 'agents', description: 'Show active agents and running tasks', category: 'Session', aliases: ['tasks'] },
  { name: 'queue', description: 'Queue a prompt for the next turn', category: 'Session', aliases: ['q'], argsHint: '<prompt>' },
  { name: 'steer', description: 'Inject a message after the next tool call', category: 'Session', argsHint: '<prompt>' },
  { name: 'status', description: 'Show session info', category: 'Session' },
  { name: 'profile', description: 'Show active profile name and home directory', category: 'Info' },
  { name: 'resume', description: 'Resume a previously named session', category: 'Session', argsHint: '[name]' },
  {
    name: 'model',
    description: 'Set this conversation model override',
    category: 'Configuration',
    argsHint: '<model>',
    executeMode: 'set_setting',
    settingKey: 'modelOverride',
  },
  {
    name: 'provider',
    description: 'Set this conversation provider override',
    category: 'Configuration',
    argsHint: '<provider>',
    executeMode: 'set_setting',
    settingKey: 'providerOverride',
  },
  {
    name: 'verbose',
    description: 'Set Hermes verbose level for this conversation',
    category: 'Configuration',
    argsHint: '<inherit|off|minimal|low|medium|high>',
    executeMode: 'set_setting',
    settingKey: 'verboseLevel',
  },
  {
    name: 'reasoning',
    description: 'Manage reasoning effort and display',
    category: 'Configuration',
    argsHint: '[level|show|hide]',
    subcommands: [
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'show',
      'hide',
      'on',
      'off',
    ],
  },
  {
    name: 'fast',
    description: 'Toggle fast mode',
    category: 'Configuration',
    argsHint: '[normal|fast|status]',
    subcommands: ['normal', 'fast', 'status', 'on', 'off'],
  },
  { name: 'personality', description: 'Set a predefined personality', category: 'Configuration', argsHint: '[name]' },
  { name: 'yolo', description: 'Toggle YOLO mode', category: 'Configuration' },
  { name: 'voice', description: 'Toggle voice mode', category: 'Configuration', argsHint: '[on|off|tts|status]', subcommands: ['on', 'off', 'tts', 'status'] },
  { name: 'toolsets', description: 'List available toolsets', category: 'Tools & Skills' },
  {
    name: 'skills',
    description: 'Search, install, inspect, or manage skills',
    category: 'Tools & Skills',
    subcommands: ['search', 'browse', 'inspect', 'install'],
  },
  {
    name: 'cron',
    description: 'Manage scheduled tasks',
    category: 'Tools & Skills',
    argsHint: '[subcommand]',
    subcommands: ['list', 'add', 'create', 'edit', 'pause', 'resume', 'run', 'remove'],
  },
  { name: 'reload-mcp', description: 'Reload MCP servers from config', category: 'Tools & Skills', aliases: ['reload_mcp'] },
  {
    name: 'browser',
    description: 'Connect browser tools to your live Chrome via CDP',
    category: 'Tools & Skills',
    argsHint: '[connect|disconnect|status]',
    subcommands: ['connect', 'disconnect', 'status'],
  },
  { name: 'plugins', description: 'List installed plugins and their status', category: 'Tools & Skills' },
  { name: 'usage', description: 'Show token usage and rate limits for the current session', category: 'Info' },
  { name: 'insights', description: 'Show usage insights and analytics', category: 'Info', argsHint: '[days]' },
  { name: 'debug', description: 'Upload debug report and get shareable links', category: 'Info' },
  {
    name: 'set-skills',
    description: 'Set enabled skills for this conversation',
    category: 'Local Settings',
    source: 'local',
    argsHint: '<comma-list>',
    executeMode: 'set_setting',
    settingKey: 'skillsOverride',
  },
  {
    name: 'set-toolsets',
    description: 'Set enabled toolsets for this conversation',
    category: 'Local Settings',
    source: 'local',
    argsHint: '<comma-list>',
    executeMode: 'set_setting',
    settingKey: 'toolsetsOverride',
  },
];

const WORKSPACE_COMMANDS: SlashCatalogItem[] = [
  {
    name: 'swarm',
    usage: '/swarm',
    description: 'Open the Workspace swarm overview',
    category: 'Workspace',
    source: 'workspace',
    insertText: '/swarm',
    executeMode: 'open_route',
    route: '/workspace',
  },
];

export function isSafeSlashCommandName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && SAFE_COMMAND_NAME.test(trimmed);
}

function slashSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[._-]{2,}/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  return isSafeSlashCommandName(slug) ? slug : 'command';
}

function reserveItemName(baseName: string, used: Set<string>): string {
  const base = slashSlug(baseName);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate) || !isSafeSlashCommandName(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function usageFor(name: string, argsHint?: string | null): string {
  return argsHint ? `/${name} ${argsHint}` : `/${name}`;
}

function commandToItem(command: CoreCommandDef): SlashCatalogItem {
  const argsHint = command.argsHint ?? null;
  return {
    name: command.name,
    usage: usageFor(command.name, argsHint),
    description: command.description,
    category: command.category,
    source: command.source ?? 'core',
    aliases: command.aliases,
    argsHint,
    subcommands: command.subcommands,
    insertText: argsHint ? `/${command.name} ` : `/${command.name}`,
    executeMode: command.executeMode ?? 'send_message',
    settingKey: command.settingKey ?? null,
  };
}

function buildSkillItems(skills: SkillInfo[], used: Set<string>): SlashCatalogItem[] {
  return skills.map((skill) => {
    const name = reserveItemName(skill.name, used);
    return {
      name,
      usage: `/${name} <instruction>`,
      description: `Invoke Hermes skill ${skill.name}`,
      category: skill.category || 'Skills',
      source: 'skill',
      argsHint: '<instruction>',
      insertText: `/${name} `,
      executeMode: 'send_message',
      skillName: skill.name,
    };
  });
}

function buildToolsetItems(toolsets: HermesToolsetInfo[], used: Set<string>): SlashCatalogItem[] {
  return toolsets.map((toolset) => {
    const name = reserveItemName(toolset.name, used);
    return {
      name,
      usage: `/${name}`,
      description: toolset.description || `Enable Hermes toolset ${toolset.name}`,
      category: 'Toolsets',
      source: 'toolset',
      insertText: `/${name}`,
      executeMode: 'set_setting',
      settingKey: 'toolsetsOverride',
      toolsetName: toolset.name,
    };
  });
}

export function buildSlashCatalog(options: BuildSlashCatalogOptions = {}): SlashCatalogItem[] {
  const used = new Set<string>();
  const coreItems = CORE_COMMANDS.map(commandToItem).filter((item) => {
    if (!isSafeSlashCommandName(item.name) || used.has(item.name)) return false;
    used.add(item.name);
    item.aliases?.forEach((alias) => {
      if (isSafeSlashCommandName(alias)) used.add(alias);
    });
    return true;
  });

  const workspaceItems = WORKSPACE_COMMANDS.filter((item) => {
    if (!isSafeSlashCommandName(item.name) || used.has(item.name)) return false;
    used.add(item.name);
    return true;
  });

  const skills = options.skills ?? listSkills(options.profile ?? null);
  const toolsets = options.toolsets ?? listToolsets();

  return [
    ...coreItems,
    ...workspaceItems,
    ...buildSkillItems(skills, used),
    ...buildToolsetItems(toolsets, used),
  ];
}

export function filterSlashCatalog(
  items: SlashCatalogItem[],
  query: string,
  limit = 50
): SlashCatalogItem[] {
  const needle = query.trim().replace(/^\//, '').toLowerCase();
  if (!needle) return items.slice(0, limit);

  return items
    .filter((item) => {
      const haystack = [
        item.name,
        item.usage,
        item.description,
        item.category,
        item.source,
        item.skillName ?? '',
        item.toolsetName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) => {
      const aStarts = a.name.startsWith(needle) ? 0 : 1;
      const bStarts = b.name.startsWith(needle) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function completeSlashCatalog(
  query: string,
  options: BuildSlashCatalogOptions = {},
  limit = 50
): SlashCatalogItem[] {
  return filterSlashCatalog(buildSlashCatalog(options), query, limit);
}

function parseSlashInput(text: string): ParsedSlashInput | null {
  const input = text.trimStart();
  if (!input.startsWith('/')) return null;

  const body = input.slice(1);
  const match = body.match(/^([^\s]*)(?:\s+([\s\S]*))?$/);
  if (!match) return { commandName: '', args: '' };

  return {
    commandName: (match[1] ?? '').toLowerCase(),
    args: (match[2] ?? '').trim(),
  };
}

function findSlashItem(items: SlashCatalogItem[], commandName: string): SlashCatalogItem | null {
  const needle = commandName.toLowerCase();
  return items.find((item) => {
    if (item.name.toLowerCase() === needle) return true;
    return (item.aliases ?? []).some((alias) => alias.toLowerCase() === needle);
  }) ?? null;
}

function buildCanonicalMessage(item: SlashCatalogItem, args: string): string {
  return args ? `/${item.name} ${args}` : `/${item.name}`;
}

function buildSkillInvocationMessage(skillName: string, instruction: string): string {
  const parts = [
    `Use the "${skillName}" skill for this request. Load and follow that skill if it is available in the active Hermes profile.`,
  ];

  if (instruction) {
    parts.push(
      '',
      `The user has provided the following instruction alongside the skill invocation: ${instruction}`
    );
  }

  return parts.join('\n');
}

function settingValueFor(item: SlashCatalogItem, args: string): string {
  if (args) return args;
  if (item.toolsetName) return item.toolsetName;
  if (item.skillName) return item.skillName;
  return '';
}

export function resolveSlashCommand(
  text: string,
  options: BuildSlashCatalogOptions = {}
): SlashResolveResult {
  const parsed = parseSlashInput(text);
  if (!parsed) return { kind: 'not_slash' };

  const item = findSlashItem(buildSlashCatalog(options), parsed.commandName);
  if (!item) return { kind: 'unknown', commandName: parsed.commandName };

  if (item.source === 'skill' && item.skillName) {
    const instruction = parsed.args;
    return {
      kind: 'web_v1_skill_invocation',
      item,
      skillName: item.skillName,
      instruction,
      messageText: buildSkillInvocationMessage(item.skillName, instruction),
    };
  }

  switch (item.executeMode) {
    case 'local':
      return { kind: 'local', item };
    case 'set_setting':
      return { kind: 'setting', item, value: settingValueFor(item, parsed.args) };
    case 'open_route':
      return { kind: 'route', item, route: item.route ?? '/' };
    case 'send_message':
    default:
      return { kind: 'send_message', item, messageText: buildCanonicalMessage(item, parsed.args) };
  }
}
