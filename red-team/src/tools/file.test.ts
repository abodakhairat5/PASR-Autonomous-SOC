// Round-trip tests for the file tools.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlwaysAllow, AlwaysDeny } from '../permission/permission.js';
import { FileEditTool, FileReadTool, FileWriteTool } from './file.js';

let tmp = '';
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pf-file-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const signal = new AbortController().signal;

describe('FileReadTool', () => {
  it('reads a regular file without prompting', async () => {
    const p = join(tmp, 'a.txt');
    writeFileSync(p, 'hello world');
    const out = await new FileReadTool().run({ path: p }, signal, new AlwaysDeny());
    expect(out).toBe('hello world');
  });

  it('errors when path missing', async () => {
    await expect(new FileReadTool().run({}, signal, new AlwaysAllow())).rejects.toThrow(/required/);
  });

  it('caps reads of large files and reports the real elided byte count', async () => {
    const p = join(tmp, 'big.txt');
    // 250KB > the 200KB read cap. Only the cap is read into RAM; the note must
    // report the real (full) size minus the cap.
    const size = 250 * 1024;
    writeFileSync(p, 'a'.repeat(size));
    const out = await new FileReadTool().run({ path: p }, signal, new AlwaysAllow());
    expect(out).toContain('truncated');
    expect(out).toContain(`${size - 200 * 1024} bytes`);
    // The returned text is bounded to roughly the cap, not the whole file.
    expect(out.length).toBeLessThan(210 * 1024);
  });
});

describe('FileWriteTool', () => {
  it('creates parents and writes content', async () => {
    const p = join(tmp, 'nested', 'b.txt');
    const out = await new FileWriteTool().run(
      { path: p, content: 'abc' },
      signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('wrote 3 bytes');
    const back = await new FileReadTool().run({ path: p }, signal, new AlwaysAllow());
    expect(back).toBe('abc');
  });
});

describe('FileEditTool', () => {
  it('replaces a unique occurrence', async () => {
    const p = join(tmp, 'c.txt');
    writeFileSync(p, 'foo bar baz');
    await new FileEditTool().run(
      { path: p, old_string: 'bar', new_string: 'qux' },
      signal,
      new AlwaysAllow(),
    );
    const after = await new FileReadTool().run({ path: p }, signal, new AlwaysAllow());
    expect(after).toBe('foo qux baz');
  });

  it('refuses when old_string is non-unique without replace_all', async () => {
    const p = join(tmp, 'd.txt');
    writeFileSync(p, 'x x x');
    await expect(
      new FileEditTool().run(
        { path: p, old_string: 'x', new_string: 'y' },
        signal,
        new AlwaysAllow(),
      ),
    ).rejects.toThrow(/appears 3 times/);
  });

  it('replaces all when replace_all=true', async () => {
    const p = join(tmp, 'e.txt');
    writeFileSync(p, 'x x x');
    await new FileEditTool().run(
      { path: p, old_string: 'x', new_string: 'y', replace_all: true },
      signal,
      new AlwaysAllow(),
    );
    const after = await new FileReadTool().run({ path: p }, signal, new AlwaysAllow());
    expect(after).toBe('y y y');
  });

  it('errors when old_string not found', async () => {
    const p = join(tmp, 'f.txt');
    writeFileSync(p, 'hello');
    await expect(
      new FileEditTool().run(
        { path: p, old_string: 'missing', new_string: 'x' },
        signal,
        new AlwaysAllow(),
      ),
    ).rejects.toThrow(/not found/);
  });
});
