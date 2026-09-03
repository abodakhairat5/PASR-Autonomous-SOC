// GlobTool + GrepTool. Glob uses fast-glob (handles ** and brace
// expansion); grep walks matched files line-by-line and prints
// path:line:match.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import fg from 'fast-glob';
import type { Prompter } from '../permission/permission.js';
import { gateSensitivePath } from './file.js';
import { type Tool, argBool, argNumber, argString } from './types.js';

const GREP_FILE_BYTE_CAP = 5 * 1024 * 1024;
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.cache',
  'coverage',
  'vendor',
  '__pycache__',
]);

export class GlobTool implements Tool {
  name(): string {
    return 'GlobTool';
  }
  description(): string {
    return 'Find files by glob pattern. Supports *, ?, character classes, and ** for recursive matching. Returns matching paths sorted by name.';
  }
  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern, for example "**/*.go" or "internal/**/*.go".',
        },
        path: {
          type: 'string',
          description: 'Optional base directory. Defaults to current working directory.',
        },
        limit: { type: 'integer', description: 'Optional max matches. Defaults to 200.' },
      },
      required: ['pattern'],
    };
  }
  requiresPermission(): boolean {
    return false;
  }

  async run(args: Record<string, unknown>, signal: AbortSignal, p: Prompter): Promise<string> {
    const pattern = argString(args, 'pattern');
    if (!pattern) throw new Error('pattern is required');
    const base = argString(args, 'path') || '.';
    const limit = Math.max(1, Math.floor(argNumber(args, 'limit') ?? 200));

    await gateSearchInputs(p, base, pattern, signal);

    const matches = await globFiles(base, pattern, limit, signal);
    for (const file of matches) {
      await gateSensitivePath(p, file, 'search', signal);
    }
    if (matches.length === 0) return 'no matches';
    return matches.join('\n');
  }
}

export class GrepTool implements Tool {
  name(): string {
    return 'GrepTool';
  }
  description(): string {
    return 'Search file contents using a regular expression. Use glob to narrow files, for example "**/*.go". Returns path:line:match.';
  }
  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for.' },
        path: {
          type: 'string',
          description: 'Optional base directory or file. Defaults to current working directory.',
        },
        glob: { type: 'string', description: 'Optional file glob filter, for example "**/*.go".' },
        ignore_case: { type: 'boolean', description: 'Case-insensitive search.' },
        limit: { type: 'integer', description: 'Optional max matches. Defaults to 200.' },
      },
      required: ['pattern'],
    };
  }
  requiresPermission(): boolean {
    return false;
  }

  async run(args: Record<string, unknown>, signal: AbortSignal, p: Prompter): Promise<string> {
    const rawPattern = argString(args, 'pattern');
    if (!rawPattern) throw new Error('pattern is required');
    const ignoreCase = argBool(args, 'ignore_case');
    const flags = ignoreCase ? 'i' : '';
    let re: RegExp;
    try {
      re = new RegExp(rawPattern, flags);
    } catch (err) {
      throw new Error(`invalid regex: ${(err as Error).message}`);
    }

    const base = argString(args, 'path') || '.';
    const glob = argString(args, 'glob') || '**/*';
    const limit = Math.max(1, Math.floor(argNumber(args, 'limit') ?? 200));

    await gateSearchInputs(p, base, glob, signal);

    // Pull sizes from the glob pass (stats: true) instead of a second per-file
    // stat, then grep with bounded concurrency. Output ordering stays
    // deterministic: entries are sorted by path and results are reassembled in
    // that order.
    const entries = await globEntries(base, glob, 10_000, signal);
    let out = await grepEntries(entries, re, limit, signal, p);

    if (out.length === 0) return 'no matches';
    if (out.length >= limit) {
      out = out.slice(0, limit);
      out.push(`[... limited to ${limit} matches ...]`);
    }
    return out.join('\n');
  }
}

async function globFiles(
  base: string,
  pattern: string,
  limit: number,
  signal: AbortSignal,
): Promise<string[]> {
  const absBase = resolve(base);
  const info = await stat(absBase);

  // Single-file case: match the base name against
  // the pattern; if it matches, return just that file.
  if (!info.isDirectory()) {
    const dir = dirname(absBase);
    const baseName = basename(absBase);
    const matches = await fg(pattern, { cwd: dir, dot: true, onlyFiles: true });
    return matches.some((m) => m === baseName || m.endsWith(`/${baseName}`)) ? [absBase] : [];
  }

  const results = await fg(pattern, {
    cwd: absBase,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: Array.from(SKIP_DIR_NAMES).map((n) => `**/${n}/**`),
  });
  if (signal.aborted) throw new Error('aborted');
  return results
    .slice(0, limit)
    .map((rel) => resolve(absBase, rel))
    .sort();
}

const GREP_CONCURRENCY = 8;

interface GlobEntry {
  path: string;
  size: number;
}

/**
 * Like globFiles but also returns each file's size (from fast-glob `stats:
 * true`), so GrepTool can gate on size without a second stat() per file.
 * Sorted by absolute path for deterministic downstream ordering.
 */
async function globEntries(
  base: string,
  pattern: string,
  limit: number,
  signal: AbortSignal,
): Promise<GlobEntry[]> {
  const absBase = resolve(base);
  const info = await stat(absBase);

  if (!info.isDirectory()) {
    const dir = dirname(absBase);
    const baseName = basename(absBase);
    const matches = await fg(pattern, { cwd: dir, dot: true, onlyFiles: true });
    if (!matches.some((m) => m === baseName || m.endsWith(`/${baseName}`))) return [];
    return [{ path: absBase, size: info.size }];
  }

  const results = (await fg(pattern, {
    cwd: absBase,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    stats: true,
    ignore: Array.from(SKIP_DIR_NAMES).map((n) => `**/${n}/**`),
  })) as unknown as Array<{ path: string; stats?: { size: number } }>;
  if (signal.aborted) throw new Error('aborted');
  return results
    .slice(0, limit)
    .map((e) => ({ path: resolve(absBase, e.path), size: e.stats?.size ?? 0 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Grep `entries` with bounded concurrency, gating each file and skipping
 * oversized ones. Workers stop pulling new files once `limit` matches have been
 * collected (early exit). Per-file results are written by index and flattened
 * in path order so output ordering is deterministic regardless of which worker
 * finishes first.
 */
async function grepEntries(
  entries: GlobEntry[],
  re: RegExp,
  limit: number,
  signal: AbortSignal,
  p: Prompter,
): Promise<string[]> {
  const results = new Array<string[]>(entries.length);
  let matched = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= entries.length) return;
      const entry = entries[i];
      if (!entry || signal.aborted || matched >= limit || entry.size > GREP_FILE_BYTE_CAP) {
        results[i] = [];
        continue;
      }
      await gateSensitivePath(p, entry.path, 'search', signal);
      const remaining = Math.max(0, limit - matched);
      const m = await grepFile(entry.path, re, remaining, signal);
      results[i] = m;
      matched += m.length;
    }
  };
  const pool = Array.from({ length: Math.min(GREP_CONCURRENCY, entries.length) }, worker);
  await Promise.all(pool);
  return results.flat();
}

async function gateSearchInputs(
  p: Prompter,
  base: string,
  pattern: string,
  signal: AbortSignal,
): Promise<void> {
  await gateSensitivePath(p, resolve(base), 'search', signal);
  const prefix = absoluteLiteralPrefix(pattern);
  if (prefix) await gateSensitivePath(p, prefix, 'search', signal);
}

function absoluteLiteralPrefix(pattern: string): string {
  if (!isAbsolute(pattern)) return '';
  const idx = pattern.search(/[*?[\]{}()!]/);
  const prefix = idx >= 0 ? pattern.slice(0, idx) : pattern;
  return prefix ? resolve(prefix) : '';
}

async function grepFile(
  path: string,
  re: RegExp,
  remaining: number,
  signal: AbortSignal,
): Promise<string[]> {
  if (remaining <= 0) return [];
  const out: string[] = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let lineNo = 0;
  try {
    for await (const line of rl) {
      if (signal.aborted) break;
      lineNo += 1;
      // Reset regex state for global flag (we don't set /g but be safe).
      re.lastIndex = 0;
      if (re.test(line)) {
        out.push(`${path}:${lineNo}:${line}`);
        if (out.length >= remaining) break;
      }
    }
  } catch {
    // Binary files / encoding issues — skip the rest silently.
  } finally {
    rl.close();
  }
  return out;
}
