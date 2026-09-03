// Sensitive-path gating for the file tools, including the symlink-smuggling
// defense (#5) and write/edit gating (#2). homedir() is mocked to a temp
// dir so these tests never touch the real ~/.ssh.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => holder.home };
});

import { AlwaysAllow, AlwaysDeny } from '../permission/permission.js';
import { FileReadTool, FileWriteTool } from './file.js';

const signal = new AbortController().signal;
let tmp = '';
beforeEach(() => {
  // Canonicalize: on macOS tmpdir() sits under /var which symlinks to
  // /private/var, so realpath() of a link target would gain a /private
  // prefix the lexical home lacks. Real homedirs (/Users/...) aren't
  // symlinks, so this only bites the test environment.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'pf-sens-')));
  holder.home = tmp; // mocked homedir → ~/.ssh etc. live under tmp
  mkdirSync(join(tmp, '.ssh'), { recursive: true });
  writeFileSync(join(tmp, '.ssh', 'id_rsa'), 'PRIVATE KEY');
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('FileReadTool sensitive gating', () => {
  it('prompts and refuses a denied read of a sensitive path', async () => {
    await expect(
      new FileReadTool().run({ path: join(tmp, '.ssh', 'id_rsa') }, signal, new AlwaysDeny()),
    ).rejects.toThrow(/sensitive path denied/);
  });

  it('reads the sensitive path when approved', async () => {
    const out = await new FileReadTool().run(
      { path: join(tmp, '.ssh', 'id_rsa') },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toBe('PRIVATE KEY');
  });

  it.skipIf(process.platform === 'win32')('catches a symlink that points into a sensitive path', async () => {
    const link = join(tmp, 'innocent.txt');
    symlinkSync(join(tmp, '.ssh', 'id_rsa'), link);
    // Lexically `innocent.txt` is not sensitive; the gate must follow the
    // link to the real target and still prompt.
    await expect(new FileReadTool().run({ path: link }, signal, new AlwaysDeny())).rejects.toThrow(
      /sensitive path denied/,
    );
  });
});

describe('FileWriteTool sensitive gating', () => {
  it('refuses a denied write to a sensitive path', async () => {
    await expect(
      new FileWriteTool().run(
        { path: join(tmp, '.ssh', 'authorized_keys'), content: 'ssh-rsa AAAA attacker' },
        signal,
        new AlwaysDeny(),
      ),
    ).rejects.toThrow(/sensitive path denied/);
  });

  it('allows the write when approved', async () => {
    const out = await new FileWriteTool().run(
      { path: join(tmp, '.ssh', 'authorized_keys'), content: 'ok' },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('wrote 2 bytes');
  });
});
