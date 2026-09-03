// ReadPayloadsTool tests. Cover the path-traversal guard (the
// security-critical behavior) and the list / read paths against a
// throwaway skill on disk.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { YoloPrompter } from '../permission/permission.js';
import { Registry } from '../skills/registry.js';
import { ReadPayloadsTool } from './payloads.js';

function makeSkillDir(): { tool: ReadPayloadsTool; skillDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pf-payloads-'));
  const skillDir = join(root, 'demo');
  mkdirSync(join(skillDir, 'payloads', 'sub'), { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: demo\ndescription: test skill\n---\n# body\n',
  );
  writeFileSync(join(skillDir, 'payloads', 'alpha.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(skillDir, 'payloads', 'sub', 'beta.txt'), 'nested\nlines\n');

  const reg = new Registry();
  reg.loadDir(root);
  const tool = new ReadPayloadsTool(reg);
  return { tool, skillDir };
}

const noopSignal = new AbortController().signal;
// YoloPrompter requires an inner prompter; pass a no-op inner.
const noopPrompter = new YoloPrompter(
  {
    confirm: async () => true,
  },
  true,
);

describe('ReadPayloadsTool', () => {
  it("lists files in a skill's payloads/ directory (sorted, including nested)", async () => {
    const { tool } = makeSkillDir();
    const out = await tool.run({ skill: 'demo', action: 'list' }, noopSignal, noopPrompter);
    const parsed = JSON.parse(out) as string[];
    expect(parsed).toContain('alpha.txt');
    expect(parsed).toContain('sub/beta.txt');
    expect(parsed).toEqual([...parsed].sort());
  });

  it('reads a payload file and returns the content with header + line count', async () => {
    const { tool } = makeSkillDir();
    const out = await tool.run({ skill: 'demo', file: 'alpha.txt' }, noopSignal, noopPrompter);
    expect(out).toContain('demo/alpha.txt');
    expect(out).toContain('one');
    expect(out).toContain('three');
  });

  it('refuses paths that escape the payloads/ directory', async () => {
    const { tool } = makeSkillDir();
    const out = await tool.run({ skill: 'demo', file: '../SKILL.md' }, noopSignal, noopPrompter);
    expect(out).toMatch(/escapes/i);
    // Absolute paths too.
    const abs = await tool.run({ skill: 'demo', file: '/etc/passwd' }, noopSignal, noopPrompter);
    expect(abs).toMatch(/escapes/i);
  });

  it('rejects an unknown skill', async () => {
    const { tool } = makeSkillDir();
    const out = await tool.run(
      { skill: 'no-such-skill', action: 'list' },
      noopSignal,
      noopPrompter,
    );
    expect(out).toMatch(/not loaded/);
  });

  it('handles a missing payloads/ directory cleanly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pf-payloads-bare-'));
    const skillDir = join(root, 'bare');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: bare\ndescription: no payloads\n---\n# body\n',
    );
    const reg = new Registry();
    reg.loadDir(root);
    const tool = new ReadPayloadsTool(reg);
    const out = await tool.run({ skill: 'bare', action: 'list' }, noopSignal, noopPrompter);
    expect(out).toMatch(/no payloads/);
  });
});
