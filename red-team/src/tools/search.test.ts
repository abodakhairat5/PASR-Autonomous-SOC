// Glob + grep behavior tests.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlwaysAllow, AlwaysDeny } from '../permission/permission.js';
import { GlobTool, GrepTool } from './search.js';

let tmp = '';
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pf-search-'));
  mkdirSync(join(tmp, 'internal', 'tools'), { recursive: true });
  writeFileSync(join(tmp, 'main.go'), 'package main\nfunc main() {}\n');
  writeFileSync(join(tmp, 'README.md'), '# x');
  writeFileSync(
    join(tmp, 'internal', 'tools', 'shell.go'),
    'package tools\nvar denied = "rm -rf /"\n',
  );
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});
const signal = new AbortController().signal;

describe('GlobTool', () => {
  it('returns matching files', async () => {
    const out = await new GlobTool().run(
      { pattern: '**/*.go', path: tmp },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('main.go');
    expect(out).toContain(join('internal', 'tools', 'shell.go'));
  });

  it('returns "no matches" when nothing matches', async () => {
    const out = await new GlobTool().run(
      { pattern: '**/*.rust', path: tmp },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toBe('no matches');
  });

  it('errors when pattern missing', async () => {
    await expect(new GlobTool().run({ path: tmp }, signal, new AlwaysAllow())).rejects.toThrow(
      /required/,
    );
  });

  it('prompts before globbing sensitive paths', async () => {
    await expect(
      new GlobTool().run({ pattern: '*', path: join(homedir(), '.ssh') }, signal, new AlwaysDeny()),
    ).rejects.toThrow(/search of sensitive path denied/);
  });
});

describe('GrepTool', () => {
  it('finds a regex match line', async () => {
    const out = await new GrepTool().run(
      { pattern: 'rm -rf', path: tmp, glob: '**/*.go' },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('shell.go');
    expect(out).toContain('rm -rf');
  });

  it('returns "no matches" when nothing matches', async () => {
    const out = await new GrepTool().run(
      { pattern: 'this_string_should_not_exist_anywhere', path: tmp },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toBe('no matches');
  });

  it('supports ignore_case', async () => {
    const out = await new GrepTool().run(
      { pattern: 'PACKAGE', path: tmp, glob: '**/*.go', ignore_case: true },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('main.go');
  });

  it('errors on invalid regex', async () => {
    await expect(
      new GrepTool().run({ pattern: '[unterminated', path: tmp }, signal, new AlwaysAllow()),
    ).rejects.toThrow(/invalid regex/);
  });

  it('prompts before grepping sensitive paths', async () => {
    await expect(
      new GrepTool().run(
        { pattern: 'BEGIN', path: join(homedir(), '.ssh') },
        signal,
        new AlwaysDeny(),
      ),
    ).rejects.toThrow(/search of sensitive path denied/);
  });

  it('greps a single file without expanding the search from filesystem root', async () => {
    const out = await new GrepTool().run(
      { pattern: 'package main', path: join(tmp, 'main.go') },
      signal,
      new AlwaysAllow(),
    );

    expect(out).toContain('main.go');
    expect(out).toContain('package main');
  });

  it('caps matches at limit and notes the limit (deterministic across many files)', async () => {
    const dir = join(tmp, 'many');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.txt`), 'needle here\n');
    }
    const out = await new GrepTool().run(
      { pattern: 'needle', path: dir, glob: '**/*.txt', limit: 10 },
      signal,
      new AlwaysAllow(),
    );
    const lines = out.split('\n');
    expect(lines).toContain('[... limited to 10 matches ...]');
    // 10 matches + the limit note line.
    expect(lines.filter((l) => l.includes('needle')).length).toBe(10);
  });

  it('finds matches across many files in a directory', async () => {
    const dir = join(tmp, 'spread');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'alpha TARGET\n');
    writeFileSync(join(dir, 'b.txt'), 'beta\n');
    writeFileSync(join(dir, 'c.txt'), 'gamma TARGET\n');
    const out = await new GrepTool().run(
      { pattern: 'TARGET', path: dir, glob: '**/*.txt' },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('a.txt');
    expect(out).toContain('c.txt');
    expect(out).not.toContain('b.txt');
  });
});
