// parseSkill (allowed-tools key + legacy alias), loadDir directory
// skipping, and validateSkill error cases.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KNOWN_TOOL_NAMES } from '../tools/aliases.js';
import { Registry, type Skill, parseSkill, validateSkill } from './registry.js';

let tmp = '';
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pf-skill-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeSkill(name: string, frontmatter: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${name}\nbody\n`);
  return join(dir, 'SKILL.md');
}

describe('parseSkill', () => {
  it('reads the allowed-tools key', () => {
    const p = writeSkill('a', 'name: a\ndescription: d\nallowed-tools:\n  - http\n  - shell');
    expect(parseSkill(p).tools).toEqual(['http', 'shell']);
  });

  it('falls back to the legacy tools key', () => {
    const p = writeSkill('b', 'name: b\ndescription: d\ntools:\n  - http');
    expect(parseSkill(p).tools).toEqual(['http']);
  });

  it('prefers allowed-tools over legacy tools when both present', () => {
    const p = writeSkill(
      'c',
      'name: c\ndescription: d\nallowed-tools:\n  - shell\ntools:\n  - http',
    );
    expect(parseSkill(p).tools).toEqual(['shell']);
  });
});

describe('Registry.loadDir directory skipping', () => {
  it('skips dot- and underscore-prefixed dirs (e.g. _template)', () => {
    writeSkill('real', 'name: real\ndescription: d');
    writeSkill('_template', 'name: _template\ndescription: d');
    writeSkill('.hidden', 'name: hidden\ndescription: d');
    const r = new Registry();
    r.loadDir(tmp);
    expect(r.list().map((s) => s.name)).toEqual(['real']);
  });
});

describe('validateSkill', () => {
  const mk = (over: Partial<Skill>): Skill => ({
    name: 'good',
    description: 'a fine description',
    tools: [],
    disableModelInvocation: false,
    path: '/x/good/SKILL.md',
    body: '',
    ...over,
  });

  it('accepts a well-formed skill', () => {
    expect(validateSkill(mk({}), KNOWN_TOOL_NAMES)).toEqual([]);
  });
  it('rejects a non-kebab name', () => {
    expect(
      validateSkill(mk({ name: 'Good', path: '/x/Good/SKILL.md' }), KNOWN_TOOL_NAMES).join(),
    ).toMatch(/lowercase-kebab/);
  });
  it('rejects a name that does not match its directory', () => {
    expect(validateSkill(mk({ name: 'other' }), KNOWN_TOOL_NAMES).join()).toMatch(/does not match/);
  });
  it('rejects an over-long description', () => {
    expect(validateSkill(mk({ description: 'x'.repeat(1025) }), KNOWN_TOOL_NAMES).join()).toMatch(
      /max 1024/,
    );
  });
  it('rejects an unknown allowed-tools entry', () => {
    expect(validateSkill(mk({ tools: ['htpp'] }), KNOWN_TOOL_NAMES).join()).toMatch(
      /not a known tool/,
    );
  });
});
