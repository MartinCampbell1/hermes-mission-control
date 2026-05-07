import { describe, expect, it } from 'vitest';
import type { SlashCatalogItem } from '../../../entities/slash';
import {
  FALLBACK_SLASH_COMMANDS,
  getMatchingSlashCommands,
  getSlashCommand,
  groupSlashCommands,
  parseSlashCommand,
  slashCommandHelpText,
  sourceLabel,
} from './slashCommands';

const dynamicCommands: SlashCatalogItem[] = [
  ...FALLBACK_SLASH_COMMANDS,
  {
    name: 'browser-use-browser',
    usage: '/browser-use-browser <instruction>',
    description: 'Invoke Hermes skill browser/use:browser',
    category: 'Automation',
    source: 'skill',
    argsHint: '<instruction>',
    insertText: '/browser-use-browser ',
    executeMode: 'send_message',
    skillName: 'browser/use:browser',
  },
  {
    name: 'web',
    usage: '/web',
    description: 'Enable Hermes web research tools',
    category: 'Toolsets',
    source: 'toolset',
    insertText: '/web',
    executeMode: 'set_setting',
    settingKey: 'toolsetsOverride',
    toolsetName: 'web',
  },
];

describe('slashCommands', () => {
  it('parses command name and args', () => {
    expect(parseSlashCommand('/model gpt-5.5')).toEqual({
      name: 'model',
      args: 'gpt-5.5',
    });
    expect(parseSlashCommand('/set-skills planning,qa')).toEqual({
      name: 'set-skills',
      args: 'planning,qa',
    });
  });

  it('ignores multiline slash-looking prompts', () => {
    expect(parseSlashCommand('/model gpt-5.5\nplease answer')).toBeNull();
  });

  it('keeps terminal skill commands separate from local overrides', () => {
    const skills = getSlashCommand('skills');
    const setSkills = getSlashCommand('set-skills');

    expect(skills?.executeMode).toBe('send_message');
    expect(skills?.settingKey).toBeUndefined();
    expect(setSkills?.executeMode).toBe('set_setting');
    expect(setSkills?.settingKey).toBe('skillsOverride');
  });

  it('filters dynamic commands by name, description, usage, and source', () => {
    const initialMenu = getMatchingSlashCommands('/', dynamicCommands).map((command) => command.name);
    expect(initialMenu).toContain('browser-use-browser');
    expect(initialMenu).toContain('web');
    expect(initialMenu).toContain('swarm');

    expect(getMatchingSlashCommands('/browser', dynamicCommands).map((command) => command.name)).toEqual([
      'browser-use-browser',
    ]);

    expect(getMatchingSlashCommands('/research', dynamicCommands).map((command) => command.name)).toEqual([
      'web',
    ]);

    expect(getMatchingSlashCommands('/workspace', dynamicCommands).map((command) => command.name)).toEqual([
      'swarm',
    ]);

    expect(getMatchingSlashCommands('/toolset', dynamicCommands).map((command) => command.name)).toEqual([
      'toolsets',
      'set-toolsets',
      'web',
    ]);
  });

  it('keeps at least one toolset and workspace command visible when skills are numerous', () => {
    const manySkills: SlashCatalogItem[] = [
      ...FALLBACK_SLASH_COMMANDS,
      ...Array.from({ length: 40 }, (_, index) => ({
        name: `skill-${index}`,
        usage: `/skill-${index} <instruction>`,
        description: `Skill ${index}`,
        category: 'Skills',
        source: 'skill' as const,
        argsHint: '<instruction>',
        insertText: `/skill-${index} `,
        executeMode: 'send_message' as const,
        skillName: `skill-${index}`,
      })),
      {
        name: 'web',
        usage: '/web',
        description: 'Enable Hermes web research tools',
        category: 'Toolsets',
        source: 'toolset',
        insertText: '/web',
        executeMode: 'set_setting',
        settingKey: 'toolsetsOverride',
        toolsetName: 'web',
      },
    ];

    const initialMenu = getMatchingSlashCommands('/', manySkills).map((command) => command.name);

    expect(initialMenu).toContain('skill-0');
    expect(initialMenu).toContain('web');
    expect(initialMenu).toContain('swarm');
  });

  it('resolves aliases against the dynamic catalog', () => {
    expect(getSlashCommand('reset', dynamicCommands)?.name).toBe('new');
  });

  it('groups commands by source for menu rendering', () => {
    const groups = groupSlashCommands(dynamicCommands);

    expect(groups.map((group) => group.source)).toEqual(['core', 'skill', 'toolset', 'workspace', 'local']);
    expect(groups.find((group) => group.source === 'skill')?.commands[0].name).toBe(
      'browser-use-browser'
    );
  });

  it('keeps commands discoverable through help text', () => {
    const help = slashCommandHelpText(dynamicCommands);

    expect(help).toContain('/compact');
    expect(help).toContain('/set-skills <comma-list>');
    expect(help).toContain('/browser-use-browser <instruction>');
    expect(sourceLabel('workspace')).toBe('workspace');
  });
});
