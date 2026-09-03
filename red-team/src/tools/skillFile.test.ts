// ReadSkillFileTool tests — list any aux file in a skill dir, refuse
// traversal, refuse SKILL.md (always loaded via load_skill).

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { YoloPrompter } from '../permission/permission.js';
import { Registry } from '../skills/registry.js';
import { ReadSkillFileTool } from './skillFile.js';

function makeFixture(): { tool: ReadSkillFileTool } {
  const root = mkdtempSync(join(tmpdir(), 'pf-skillfile-'));
  const sk = join(root, 'demo');
  mkdirSync(join(sk, 'payloads'), { recursive: true });
  mkdirSync(join(sk, 'scripts'));
  mkdirSync(join(sk, 'data'));
  writeFileSync(join(sk, 'SKILL.md'), '---\nname: demo\ndescription: t\n---\nbody\n');
  writeFileSync(join(sk, 'payloads', 'alpha.txt'), 'one\ntwo\n');
  writeFileSync(join(sk, 'scripts', 'check.sh'), '#!/bin/sh\necho ok\n');
  writeFileSync(join(sk, 'data', 'config.json'), '{"v":1}\n');
  const reg = new Registry();
  reg.loadDir(root);
  return { tool: new ReadSkillFileTool(reg) };
}

const noopSignal = new AbortController().signal;
const noopPrompter = new YoloPrompter({ confirm: async () => true }, true);

describe('ReadSkillFileTool', () => {
  it('lists all aux files but hides SKILL.md', async () => {
    const { tool } = makeFixture();
    const out = await tool.run({ skill: 'demo', action: 'list' }, noopSignal, noopPrompter);
    const parsed = JSON.parse(out) as string[];
    expect(parsed).toContain('payloads/alpha.txt');
    expect(parsed).toContain('scripts/check.sh');
    expect(parsed).toContain('data/config.json');
    expect(parsed).not.toContain('SKILL.md');
  });

  it('reads files from any subdir under the skill', async () => {
    const { tool } = makeFixture();
    const out = await tool.run(
      { skill: 'demo', path: 'scripts/check.sh' },
      noopSignal,
      noopPrompter,
    );
    expect(out).toMatch(/demo[/\\]scripts[/\\]check\.sh/);
    expect(out).toContain('echo ok');
  });

  it('refuses ../ traversal', async () => {
    const { tool } = makeFixture();
    const out = await tool.run(
      { skill: 'demo', path: '../../etc/passwd' },
      noopSignal,
      noopPrompter,
    );
    expect(out).toMatch(/escapes/i);
  });

  it('refuses absolute paths', async () => {
    const { tool } = makeFixture();
    const out = await tool.run({ skill: 'demo', path: '/etc/passwd' }, noopSignal, noopPrompter);
    expect(out).toMatch(/escapes/i);
  });

  it('refuses reading SKILL.md directly', async () => {
    const { tool } = makeFixture();
    const out = await tool.run({ skill: 'demo', path: 'SKILL.md' }, noopSignal, noopPrompter);
    expect(out).toMatch(/load_skill/);
  });
});
