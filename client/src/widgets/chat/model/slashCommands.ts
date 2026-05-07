import type { SlashCatalogItem, SlashItemSource } from '../../../entities/slash';

export interface ParsedSlashCommand {
  name: string;
  args: string;
}

export const FALLBACK_SLASH_COMMANDS: SlashCatalogItem[] = [
  {
    name: 'help',
    usage: '/help',
    description: 'Show available chat commands',
    category: 'Info',
    source: 'core',
    insertText: '/help',
    executeMode: 'local',
  },
  {
    name: 'new',
    usage: '/new',
    description: 'Start a new Hermes session for this agent',
    category: 'Session',
    source: 'core',
    aliases: ['reset'],
    insertText: '/new',
    executeMode: 'local',
  },
  {
    name: 'clear',
    usage: '/clear',
    description: 'Clear the current composer draft and attachments',
    category: 'Session',
    source: 'core',
    insertText: '/clear',
    executeMode: 'local',
  },
  {
    name: 'settings',
    usage: '/settings',
    description: 'Open or close the session settings bar',
    category: 'Configuration',
    source: 'local',
    insertText: '/settings',
    executeMode: 'local',
  },
  {
    name: 'compact',
    usage: '/compact',
    description: 'Ask Hermes to compact and summarize this conversation context',
    category: 'Session',
    source: 'core',
    insertText: '/compact',
    executeMode: 'local',
  },
  {
    name: 'model',
    usage: '/model <model>',
    description: 'Set this conversation model override',
    category: 'Configuration',
    source: 'core',
    argsHint: '<model>',
    insertText: '/model ',
    executeMode: 'set_setting',
    settingKey: 'modelOverride',
  },
  {
    name: 'provider',
    usage: '/provider <provider>',
    description: 'Set this conversation provider override',
    category: 'Configuration',
    source: 'core',
    argsHint: '<provider>',
    insertText: '/provider ',
    executeMode: 'set_setting',
    settingKey: 'providerOverride',
  },
  {
    name: 'skills',
    usage: '/skills',
    description: 'Search, install, inspect, or manage skills',
    category: 'Tools & Skills',
    source: 'core',
    subcommands: ['search', 'browse', 'inspect', 'install'],
    insertText: '/skills',
    executeMode: 'send_message',
  },
  {
    name: 'toolsets',
    usage: '/toolsets',
    description: 'List available toolsets',
    category: 'Tools & Skills',
    source: 'core',
    insertText: '/toolsets',
    executeMode: 'send_message',
  },
  {
    name: 'set-skills',
    usage: '/set-skills <comma-list>',
    description: 'Set enabled skills for this conversation',
    category: 'Local Settings',
    source: 'local',
    argsHint: '<comma-list>',
    insertText: '/set-skills ',
    executeMode: 'set_setting',
    settingKey: 'skillsOverride',
  },
  {
    name: 'set-toolsets',
    usage: '/set-toolsets <comma-list>',
    description: 'Set enabled toolsets for this conversation',
    category: 'Local Settings',
    source: 'local',
    argsHint: '<comma-list>',
    insertText: '/set-toolsets ',
    executeMode: 'set_setting',
    settingKey: 'toolsetsOverride',
  },
  {
    name: 'verbose',
    usage: '/verbose <inherit|off|minimal|low|medium|high>',
    description: 'Set Hermes verbose level for this conversation',
    category: 'Configuration',
    source: 'core',
    argsHint: '<level>',
    insertText: '/verbose ',
    executeMode: 'set_setting',
    settingKey: 'verboseLevel',
  },
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

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  if (!text.startsWith('/') || text.includes('\n')) return null;
  const [rawName = '', ...rest] = text.slice(1).trimStart().split(/\s+/);
  const name = rawName.toLowerCase();
  if (!name) return { name: '', args: '' };
  return { name, args: rest.join(' ').trim() };
}

export function getSlashCommand(
  name: string,
  commands: SlashCatalogItem[] = FALLBACK_SLASH_COMMANDS
): SlashCatalogItem | undefined {
  const normalized = name.toLowerCase();
  return commands.find(
    (command) =>
      command.name.toLowerCase() === normalized ||
      (command.aliases ?? []).some((alias) => alias.toLowerCase() === normalized)
  );
}

function searchableText(command: SlashCatalogItem): string {
  return [
    command.name,
    command.usage,
    command.description,
    command.category,
    command.source,
    command.skillName,
    command.toolsetName,
    ...(command.aliases ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function prioritizeInitialMenu(commands: SlashCatalogItem[], limit: number): SlashCatalogItem[] {
  const selected: SlashCatalogItem[] = [];
  const seen = new Set<string>();
  const preferredNames = [
    'new',
    'help',
    'skills',
    'toolsets',
    'set-skills',
    'set-toolsets',
    'swarm',
    'settings',
    'compact',
    'model',
    'provider',
    'verbose',
  ];
  const sources: SlashItemSource[] = ['skill', 'toolset', 'workspace', 'core', 'local'];
  const sourcePreview: SlashItemSource[] = ['skill', 'toolset', 'workspace'];

  const add = (command: SlashCatalogItem | undefined) => {
    if (!command || seen.has(command.name) || selected.length >= limit) return;
    selected.push(command);
    seen.add(command.name);
  };

  preferredNames.forEach((name) => add(getSlashCommand(name, commands)));
  sourcePreview.forEach((source) => add(commands.find((command) => command.source === source)));
  sources.forEach((source) => commands.filter((command) => command.source === source).forEach(add));
  commands.forEach(add);

  return selected;
}

export function getMatchingSlashCommands(
  text: string,
  commands: SlashCatalogItem[] = FALLBACK_SLASH_COMMANDS,
  limit = 24
): SlashCatalogItem[] {
  const parsed = parseSlashCommand(text);
  if (!parsed) return [];
  const query = parsed.name.trim().toLowerCase();
  const terms = query.split(/[-_\s]+/).filter(Boolean);

  if (!terms.length) return prioritizeInitialMenu(commands, limit);

  return commands
    .filter((command) => terms.every((term) => searchableText(command).includes(term)))
    .slice(0, limit);
}

export function groupSlashCommands(
  commands: SlashCatalogItem[]
): Array<{ source: SlashItemSource; commands: SlashCatalogItem[] }> {
  const groups: SlashItemSource[] = ['core', 'skill', 'toolset', 'workspace', 'local'];
  return groups
    .map((source) => ({ source, commands: commands.filter((command) => command.source === source) }))
    .filter((group) => group.commands.length > 0);
}

export function sourceLabel(source: SlashItemSource): string {
  switch (source) {
    case 'core':
      return 'core';
    case 'skill':
      return 'skill';
    case 'toolset':
      return 'toolset';
    case 'workspace':
      return 'workspace';
    case 'local':
      return 'local';
    default:
      return source;
  }
}

export function slashCommandHelpText(commands: SlashCatalogItem[] = FALLBACK_SLASH_COMMANDS): string {
  return commands.map((command) => `${command.usage} - ${command.description}`).join('\n');
}
