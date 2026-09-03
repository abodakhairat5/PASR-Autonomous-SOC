// Tests for the @file mention helpers — context detection used by the
// picker UI, plus directory-aware listing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findActiveMention,
  listMentionDir,
  mentionCandidates,
  parseMentionPath,
} from './mentions.js';

describe('findActiveMention', () => {
  it('detects an @token at the start of input', () => {
    const r = findActiveMention('@READ');
    expect(r).toEqual({ at: 0, partial: 'READ' });
  });

  it('detects an @token after whitespace', () => {
    const r = findActiveMention('look at @READ');
    expect(r).toEqual({ at: 8, partial: 'READ' });
  });

  it('returns null when @token is closed by whitespace', () => {
    expect(findActiveMention('look at @README.md and tell me')).toBeNull();
  });

  it('returns null when input has no @', () => {
    expect(findActiveMention('hello')).toBeNull();
  });

  it('ignores @ embedded in a word (e.g. an email)', () => {
    expect(findActiveMention('user@example.com')).toBeNull();
  });

  it('ignores @http... URLs', () => {
    expect(findActiveMention('@https://example.com')).toBeNull();
  });

  it('returns partial="" for a bare @', () => {
    expect(findActiveMention('@')).toEqual({ at: 0, partial: '' });
    expect(findActiveMention('look at @')).toEqual({ at: 8, partial: '' });
  });
});

describe('parseMentionPath', () => {
  it('splits at the final slash', () => {
    expect(parseMentionPath('src/ag')).toEqual({ dir: 'src/', base: 'ag' });
    expect(parseMentionPath('src/')).toEqual({ dir: 'src/', base: '' });
    expect(parseMentionPath('READ')).toEqual({ dir: '', base: 'READ' });
    expect(parseMentionPath('')).toEqual({ dir: '', base: '' });
  });

  it('preserves ../ chains', () => {
    expect(parseMentionPath('../')).toEqual({ dir: '../', base: '' });
    expect(parseMentionPath('../tools/x')).toEqual({ dir: '../tools/', base: 'x' });
    expect(parseMentionPath('../../tools/')).toEqual({ dir: '../../tools/', base: '' });
  });

  it('handles absolute paths', () => {
    expect(parseMentionPath('/etc/host')).toEqual({ dir: '/etc/', base: 'host' });
  });
});

describe('listMentionDir', () => {
  let root = '';
  let cwd = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pf-picker-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'src', 'agent'));
    writeFileSync(join(root, 'src', 'agent', 'agent.ts'), '// agent\n');
    writeFileSync(join(root, 'src', 'agent', 'mentions.ts'), '// mentions\n');
    writeFileSync(join(root, 'README.md'), '# x\n');
    writeFileSync(join(root, '.hidden'), 'h');
    cwd = process.cwd();
    process.chdir(root);
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  });

  it('lists cwd entries when dir is empty', () => {
    const out = listMentionDir('', '', 20);
    const names = out.map((c) => c.display);
    expect(names).toContain('README.md');
    expect(names).toContain('src/');
    // Hidden files filtered unless the user types a dot prefix.
    expect(names).not.toContain('.hidden');
  });

  it('shows hidden entries when base starts with a dot', () => {
    const out = listMentionDir('', '.', 20);
    expect(out.map((c) => c.display)).toContain('.hidden');
  });

  it('filters by base name (case-insensitive)', () => {
    const out = listMentionDir('', 'READ', 20);
    const names = out.map((c) => c.display);
    expect(names).toContain('README.md');
    expect(names).not.toContain('src/');
  });

  it('descends a directory prefix', () => {
    const out = listMentionDir('src/', '', 20);
    const names = out.map((c) => c.display);
    expect(names).toContain('agent/');
    expect(names).toContain('../');
  });

  it('descends two levels via nested dir prefix', () => {
    const out = listMentionDir('src/agent/', '', 20);
    const names = out.map((c) => c.display);
    expect(names).toContain('agent.ts');
    expect(names).toContain('mentions.ts');
    expect(names).toContain('../');
  });

  it('marks directories as isDir and pins .. to the top', () => {
    const out = listMentionDir('src/', '', 20);
    expect(out[0]?.display).toBe('../');
    expect(out[0]?.isDir).toBe(true);
    const agent = out.find((c) => c.display === 'agent/');
    expect(agent?.isDir).toBe(true);
  });

  it('builds insert values rooted at the typed dir prefix', () => {
    const out = listMentionDir('src/', '', 20);
    const agent = out.find((c) => c.display === 'agent/');
    expect(agent?.insert).toBe('src/agent/');
    const up = out.find((c) => c.display === '../');
    expect(up?.insert).toBe('src/../');
  });

  it('returns an empty list for a missing directory', () => {
    const out = listMentionDir('nonexistent/', '', 20);
    expect(out).toEqual([]);
  });
});

describe('mentionCandidates (legacy basename index)', () => {
  it('still works for unambiguous basename lookup', () => {
    // mentionCandidates uses the live cwd index — run from a known dir.
    const cwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), 'pf-basename-'));
    writeFileSync(join(tmp, 'unique-thing.txt'), 'x');
    process.chdir(tmp);
    try {
      const out = mentionCandidates('unique', 5);
      expect(out.length).toBe(1);
      expect(out[0]).toContain('unique-thing.txt');
    } finally {
      process.chdir(cwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
