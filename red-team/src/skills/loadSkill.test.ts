// Tests for the load_skill tool + materializeSkillBody. Covers:
//   * ${SKILL_DIR} substitution
//   * refusal of disabled skills
//   * refusal of disable-model-invocation skills via load_skill
//   * helpful Available: list excludes hidden skills

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { YoloPrompter } from '../permission/permission.js';
import { LoadSkillTool } from './loadSkill.js';
import { Registry, materializeSkillBody, parseSkill } from './registry.js';

function makeTmpSkills(): { dir: string; reg: Registry } {
  const root = mkdtempSync(join(tmpdir(), 'pf-loadskill-'));
  // Plain skill.
  mkdirSync(join(root, 'alpha'));
  writeFileSync(
    join(root, 'alpha', 'SKILL.md'),
    [
      '---',
      'name: alpha',
      'description: regular skill',
      'tools:',
      '  - shell',
      '  - http',
      '---',
      '# alpha body',
      'use ${SKILL_DIR}/script.sh — should resolve to an absolute path',
    ].join('\n'),
  );
  // User-only skill (hidden from model).
  mkdirSync(join(root, 'beta'));
  writeFileSync(
    join(root, 'beta', 'SKILL.md'),
    [
      '---',
      'name: beta',
      'description: user-only skill',
      'disable-model-invocation: true',
      '---',
      '# beta body',
    ].join('\n'),
  );
  const reg = new Registry();
  reg.loadDir(root);
  return { dir: root, reg };
}

const noopSignal = new AbortController().signal;
const noopPrompter = new YoloPrompter({ confirm: async () => true }, true);

describe('parseSkill', () => {
  it('parses disable-model-invocation in kebab-case and camelCase', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf-parse-'));
    mkdirSync(join(root, 'kebab'));
    writeFileSync(
      join(root, 'kebab', 'SKILL.md'),
      '---\nname: kebab\ndescription: x\ndisable-model-invocation: true\n---\n# body\n',
    );
    mkdirSync(join(root, 'camel'));
    writeFileSync(
      join(root, 'camel', 'SKILL.md'),
      '---\nname: camel\ndescription: y\ndisableModelInvocation: true\n---\n# body\n',
    );
    expect(parseSkill(join(root, 'kebab', 'SKILL.md')).disableModelInvocation).toBe(true);
    expect(parseSkill(join(root, 'camel', 'SKILL.md')).disableModelInvocation).toBe(true);
  });

  it('defaults disable-model-invocation to false when absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf-parse-'));
    mkdirSync(join(root, 'plain'));
    writeFileSync(
      join(root, 'plain', 'SKILL.md'),
      '---\nname: plain\ndescription: z\n---\n# body\n',
    );
    expect(parseSkill(join(root, 'plain', 'SKILL.md')).disableModelInvocation).toBe(false);
  });
});

describe('materializeSkillBody', () => {
  it('substitutes ${SKILL_DIR} with the skill directory', () => {
    const { dir, reg } = makeTmpSkills();
    const skill = reg.get('alpha');
    if (!skill) throw new Error('alpha not loaded');
    const body = materializeSkillBody(skill);
    expect(body).not.toContain('${SKILL_DIR}');
    expect(body).toContain(join(dir, 'alpha'));
    expect(body.startsWith('# Skill: alpha')).toBe(true);
  });

  it('replaces every occurrence, not just the first', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf-multi-'));
    mkdirSync(join(root, 'multi'));
    writeFileSync(
      join(root, 'multi', 'SKILL.md'),
      '---\nname: multi\ndescription: x\n---\n${SKILL_DIR}/a\n${SKILL_DIR}/b\n${SKILL_DIR}/c\n',
    );
    const reg = new Registry();
    reg.loadDir(root);
    const skill = reg.get('multi');
    if (!skill) throw new Error('multi not loaded');
    const body = materializeSkillBody(skill);
    expect(body.match(/\$\{SKILL_DIR\}/g)).toBeNull();
    expect(body.split(join(root, 'multi')).length).toBe(4); // 3 replacements → 4 splits
  });
});

describe('LoadSkillTool', () => {
  it('returns materialized body for a normal skill', async () => {
    const { reg } = makeTmpSkills();
    const tool = new LoadSkillTool(reg);
    const out = await tool.run({ name: 'alpha' }, noopSignal, noopPrompter);
    expect(out).toContain('# Skill: alpha');
    expect(out).toContain('# alpha body');
    expect(out).not.toContain('${SKILL_DIR}');
  });

  it('refuses a disabled skill', async () => {
    const { reg } = makeTmpSkills();
    reg.setDisabled('alpha', true);
    const tool = new LoadSkillTool(reg);
    await expect(tool.run({ name: 'alpha' }, noopSignal, noopPrompter)).rejects.toThrow(/disabled/);
  });

  it('refuses a disable-model-invocation skill', async () => {
    const { reg } = makeTmpSkills();
    const tool = new LoadSkillTool(reg);
    await expect(tool.run({ name: 'beta' }, noopSignal, noopPrompter)).rejects.toThrow(
      /disable-model-invocation/,
    );
  });

  it('excludes hidden skills from the Available: hint', async () => {
    const { reg } = makeTmpSkills();
    const tool = new LoadSkillTool(reg);
    try {
      await tool.run({ name: 'nonexistent' }, noopSignal, noopPrompter);
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('alpha');
      expect(msg).not.toContain('beta'); // hidden from list
    }
  });
});
