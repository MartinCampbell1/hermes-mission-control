import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlashCatalog,
  completeSlashCatalog,
  isSafeSlashCommandName,
  resolveSlashCommand,
} from '../../src/services/hermes/slash';
import { SkillInfo } from '../../src/@types/skill';
import { HermesToolsetInfo } from '../../src/services/hermes/toolsets';

const skills: SkillInfo[] = [
  { name: 'browser/use:browser', category: 'Automation', source: 'local', trust: 'trusted' },
  { name: 'new', category: 'Session', source: 'builtin', trust: 'trusted' },
];

const toolsets: HermesToolsetInfo[] = [
  { name: 'web', description: 'Web research tools' },
  { name: 'skills', description: 'Skill management tools' },
];

function testCatalog() {
  return buildSlashCatalog({ skills, toolsets });
}

test('slash catalog includes core commands and explicit local setting commands', () => {
  const names = new Set(testCatalog().map((item) => item.name));

  ['help', 'new', 'clear', 'compact', 'skills', 'toolsets', 'set-skills', 'set-toolsets'].forEach(
    (name) => assert.equal(names.has(name), true, `missing /${name}`)
  );

  const skillsCommand = testCatalog().find((item) => item.name === 'skills');
  assert.equal(skillsCommand?.source, 'core');
  assert.equal(skillsCommand?.executeMode, 'send_message');

  const setSkillsCommand = testCatalog().find((item) => item.name === 'set-skills');
  assert.equal(setSkillsCommand?.source, 'local');
  assert.equal(setSkillsCommand?.executeMode, 'set_setting');
  assert.equal(setSkillsCommand?.settingKey, 'skillsOverride');
});

test('skill names become collision-safe slugs and keep original skillName', () => {
  const catalog = testCatalog();
  const browserSkill = catalog.find((item) => item.skillName === 'browser/use:browser');
  const newSkill = catalog.find((item) => item.skillName === 'new');

  assert.equal(browserSkill?.name, 'browser-use-browser');
  assert.equal(browserSkill?.source, 'skill');
  assert.equal(browserSkill?.insertText, '/browser-use-browser ');

  assert.equal(newSkill?.name, 'new-2');
  assert.equal(newSkill?.source, 'skill');
});

test('toolsets appear as toolset source items with collision-safe names', () => {
  const catalog = testCatalog();
  const webToolset = catalog.find((item) => item.toolsetName === 'web');
  const skillsToolset = catalog.find((item) => item.toolsetName === 'skills');

  assert.equal(webToolset?.source, 'toolset');
  assert.equal(webToolset?.name, 'web');
  assert.equal(webToolset?.executeMode, 'set_setting');
  assert.equal(webToolset?.settingKey, 'toolsetsOverride');

  assert.equal(skillsToolset?.source, 'toolset');
  assert.equal(skillsToolset?.name, 'skills-2');
});

test('/swarm appears as workspace route command', () => {
  const swarm = testCatalog().find((item) => item.name === 'swarm');

  assert.equal(swarm?.source, 'workspace');
  assert.equal(swarm?.executeMode, 'open_route');
  assert.equal(swarm?.route, '/workspace');
});

test('/swarm stays inside the default API limit even with many dynamic skills', () => {
  const manySkills = Array.from({ length: 260 }, (_, index) => ({
    name: `skill-${index}`,
    category: 'Skills',
    source: 'local',
    trust: 'trusted',
  })) satisfies SkillInfo[];
  const limited = buildSlashCatalog({ skills: manySkills, toolsets }).slice(0, 200);

  assert.equal(limited.some((item) => item.name === 'swarm'), true);
});

test('catalog emits only safe command names', () => {
  const catalog = testCatalog();
  catalog.forEach((item) => {
    assert.equal(isSafeSlashCommandName(item.name), true, `unsafe name: ${item.name}`);
    assert.doesNotMatch(item.name, /[\/\\\s;&|`$<>(){}[\]*?!'"#~]/);
  });

  ['bad/name', 'bad\\name', 'bad name', 'bad;name', 'bad$name'].forEach((name) => {
    assert.equal(isSafeSlashCommandName(name), false, `accepted unsafe name: ${name}`);
  });
});

test('slash completion filters by command name and metadata', () => {
  assert.deepEqual(
    completeSlashCatalog('/browser', { skills, toolsets }).map((item) => item.name),
    ['browser', 'browser-use-browser']
  );

  assert.deepEqual(
    completeSlashCatalog('web research', { skills, toolsets }).map((item) => item.name),
    ['web']
  );
});

test('slash resolve invokes skill commands through explicit web v1 payloads', () => {
  const result = resolveSlashCommand('/browser-use-browser open localhost', { skills, toolsets });

  assert.equal(result.kind, 'web_v1_skill_invocation');
  if (result.kind !== 'web_v1_skill_invocation') return;
  assert.equal(result.item.name, 'browser-use-browser');
  assert.equal(result.skillName, 'browser/use:browser');
  assert.equal(result.instruction, 'open localhost');
  assert.match(result.messageText, /browser\/use:browser/);
  assert.match(result.messageText, /open localhost/);
});

test('slash resolve matches aliases and local commands', () => {
  const result = resolveSlashCommand('/reset', { skills, toolsets });

  assert.equal(result.kind, 'local');
  if (result.kind !== 'local') return;
  assert.equal(result.item.name, 'new');
});

test('slash resolve routes workspace commands', () => {
  const result = resolveSlashCommand('/swarm', { skills, toolsets });

  assert.equal(result.kind, 'route');
  if (result.kind !== 'route') return;
  assert.equal(result.item.name, 'swarm');
  assert.equal(result.route, '/workspace');
});

test('slash resolve keeps explicit setting commands separate from core skill commands', () => {
  const setting = resolveSlashCommand('/set-skills a,b', { skills, toolsets });
  assert.equal(setting.kind, 'setting');
  if (setting.kind !== 'setting') return;
  assert.equal(setting.item.name, 'set-skills');
  assert.equal(setting.item.settingKey, 'skillsOverride');
  assert.equal(setting.value, 'a,b');

  const coreSkills = resolveSlashCommand('/skills', { skills, toolsets });
  assert.equal(coreSkills.kind, 'send_message');
  if (coreSkills.kind !== 'send_message') return;
  assert.equal(coreSkills.item.name, 'skills');
  assert.equal(coreSkills.messageText, '/skills');
});

test('slash resolve marks unknown slash commands without downgrading to normal message', () => {
  assert.deepEqual(resolveSlashCommand('/foo', { skills, toolsets }), {
    kind: 'unknown',
    commandName: 'foo',
  });

  assert.deepEqual(resolveSlashCommand('/bad/name text', { skills, toolsets }), {
    kind: 'unknown',
    commandName: 'bad/name',
  });
});

test('slash resolve ignores non-slash text', () => {
  assert.deepEqual(resolveSlashCommand('hello Hermes', { skills, toolsets }), {
    kind: 'not_slash',
  });
});
