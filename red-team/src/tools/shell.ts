// Shell + bash tools. Each invocation requires permission. A denylist
// blocks obviously destructive patterns up front so the model can't
// accidentally rm -rf / even with user consent. Output is truncated to
// keep context windows sane.
//
// PASR extension: shell commands pass through the Policy Engine for scope
// validation. Commands targeting URLs have their destinations checked against
// the engagement scope. Non-URL commands in AUTHORIZED_REMOTE mode require
// additional approval.

import { spawn } from 'node:child_process';
import type { EvidenceStore } from '../evidence/store.js';
import type { Prompter } from '../permission/permission.js';
import { PolicyEngine } from '../policy/policy.js';
import type { Target } from '../target/target.js';
import { decodeUtf8Capped } from './file.js';
import { type Tool, argString } from './types.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 64 * 1024;

// Windows has no /bin/sh or /bin/bash, so spawning the Unix shell path fails
// with `ENOENT: no such file or directory, uv_spawn '/bin/sh'`. On Windows we
// run commands through PowerShell instead — it is closer to the Unix idioms the
// tool descriptions assume than cmd.exe, and supports pipelines/quoting cleanly.
// Override with PFLOW_WINDOWS_SHELL (e.g. "pwsh.exe" or "%ComSpec%") if needed.
// Evaluated at call time (not module load) so tests can exercise both paths.
function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Build the spawn target for a command string on the current platform.
 * POSIX: `<unixShell> -c "<command>"`. Windows: PowerShell `-Command`.
 */
export function shellInvocation(
  unixShell: string,
  command: string,
): { cmd: string; argv: string[] } {
  if (isWindows()) {
    const shell = process.env.PFLOW_WINDOWS_SHELL || 'powershell.exe';
    return { cmd: shell, argv: ['-NoProfile', '-NonInteractive', '-Command', command] };
  }
  return { cmd: unixShell, argv: ['-c', command] };
}

/**
 * Advisory denylist for catastrophic commands. This is defense-in-depth
 * behind the per-command permission prompt, NOT a security boundary — a
 * determined model can phrase destructive work around it. It exists to
 * catch obvious foot-guns (rm -rf of root/top-level dirs, fork bombs,
 * disk wipes) before they reach a hurried "allow".
 */
export const DENY_PATTERNS: RegExp[] = [
  // rm -rf targeting root or a single top-level dir (/, /*, /home, /home/).
  // Matches short (-rf, -fr) and long (--recursive --force) flag forms, in
  // either order; deeper paths like /home/user are left to the operator.
  /\brm\b(?=[^|;&\n]*\s-{1,2}[a-z-]*r)(?=[^|;&\n]*\s-{1,2}[a-z-]*f)[^|;&\n]*\s\/[^/\s]*\/?(?:\s|$)/i,
  /\brm\b(?=[^|;&\n]*\s-{1,2}[a-z-]*r)(?=[^|;&\n]*\s-{1,2}[a-z-]*f)[^|;&\n]*\s["']\/[^/"'\s]*\/?["'](?:\s|$)/i,
  /:\(\)\s*\{\s*:\|:&\s*\}/i, // fork bomb
  /\bmkfs\b/i,
  /\bdd\b[^|;&\n]*\bof=\/dev\//i,
  />\s*\/dev\/sd[a-z]/i,
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,
  /\bfind\b[^|;&\n]*\s-delete\b/i, // find / -delete
  /\bfind\b[^|;&\n]*\s-exec\s+rm\b/i, // find / -exec rm
];

const PORTABILITY_PATTERNS: Array<{ re: RegExp; message: string }> = [
  {
    re: /\bgrep\s+(?:-[A-Za-z]*P[A-Za-z]*|--perl-regexp)\b/,
    message:
      'grep -P/--perl-regexp is GNU-only and fails on macOS/BSD grep. Use grep -E, awk, sed, perl -ne, or jq instead.',
  },
  {
    re: /\bsed\s+-[A-Za-z]*r[A-Za-z]*\b/,
    message: 'sed -r is GNU-only. Use sed -E for portable extended regular expressions.',
  },
  {
    re: /\bbase64\s+[^|;&\n]*-[A-Za-z]*w\d*[A-Za-z]*\b/,
    message:
      'base64 -w is GNU-only. Omit wrapping flags on macOS/BSD, or strip newlines with tr -d "\\n".',
  },
  {
    re: /\breadlink\s+-[A-Za-z]*f[A-Za-z]*\b/,
    message:
      'readlink -f is GNU-only. Use python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" <path> or pwd -P based logic.',
  },
  {
    re: /\bdate\s+[^|;&\n]*-[A-Za-z]*d[A-Za-z]*\b/,
    message:
      'date -d is GNU-only. Use portable shell date handling or a short python3/perl snippet for date parsing.',
  },
  {
    re: /\bxargs\s+-[A-Za-z]*r[A-Za-z]*\b/,
    message:
      'xargs -r is GNU-only. Guard input explicitly before xargs for macOS/BSD compatibility.',
  },
  {
    re: /\bstat\s+-c\b/,
    message: 'stat -c is GNU-only. Use stat -f on macOS/BSD or a portable python3 os.stat snippet.',
  },
  {
    re: /\bsort\s+-[A-Za-z]*V[A-Za-z]*\b/,
    message: 'sort -V is GNU-only. Use plain sort or a small python3 version-sort snippet.',
  },
  {
    re: /(^|[|;&\s])timeout\s+\d/,
    message:
      'timeout is not available by default on macOS. Use the tool timeout_seconds argument or implement timeout in python3.',
  },
];

// Only rewrite `grep` at a command position (start of string or right after a
// shell separator), so a literal `grep -P ...` inside an `echo`/`awk` string is
// not matched and corrupted. The leading separator + whitespace are captured so
// the rewrite can re-emit them verbatim.
const GREP_P_RE =
  /(^|[\n|;&(])([ \t]*)grep\s+((?:(?:-[A-Za-z]+|--perl-regexp)\s+)*)((?:'[^']*')|(?:"[^"]*")|(?:\\.|[^\s|;&])+)([^|;&\n]*)/g;

export class ShellTool implements Tool {
  private readonly shellPath: string;
  private readonly toolName: string;
  private readonly target?: Target;
  private readonly policy?: PolicyEngine;
  private readonly evidenceStore?: EvidenceStore;

  constructor(
    shell = '/bin/sh',
    toolName = 'shell',
    target?: Target,
    policy?: PolicyEngine,
    evidenceStore?: EvidenceStore,
  ) {
    this.shellPath = shell;
    this.toolName = toolName;
    this.target = target;
    this.policy = policy ?? (target ? new PolicyEngine(target) : undefined);
    this.evidenceStore = evidenceStore;
  }

  name(): string {
    return this.toolName;
  }

  description(): string {
    if (isWindows()) {
      return [
        'Run a shell command via PowerShell on the local machine. Primary use case is curl/Invoke-WebRequest plus standard utilities for HTTP testing, file inspection, and one-liners. The user will be prompted to approve each command. Capture concise output — pipe through `Select-Object -First` for huge outputs. Do not run interactive commands. Authorized engagements only.',
        'Write PowerShell-compatible commands. Unix-only tools (grep, sed, awk, jq) may be absent; prefer PowerShell equivalents (Select-String, -replace, ConvertFrom-Json) unless you know the tool is installed.',
        '',
        'Default to curl/Invoke-WebRequest for HTTP work; only use specialized scanners (ffuf, nuclei, sqlmap, etc.) when the user explicitly asks for them.',
      ].join('\n');
    }
    return [
      'Run a shell command via /bin/sh -c on the local machine. Primary use case is curl + standard Unix utilities (jq, grep, awk, sed, head, sort, uniq) for HTTP testing, file inspection, and bash one-liners. The user will be prompted to approve each command. Capture concise output — pipe through `head` for huge outputs. Do not run interactive commands. Authorized engagements only.',
      'Write portable macOS/BSD + Linux commands. Avoid GNU-only flags such as `grep -P`; prefer `grep -E`, `awk`, `sed`, `perl -ne`, or `jq` for extraction.',
      '',
      'Default to curl for HTTP work; only use specialized scanners (ffuf, nuclei, sqlmap, etc.) when the user explicitly asks for them.',
    ].join('\n');
  }

  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: isWindows()
            ? 'Shell command to execute. Will run via PowerShell -Command.'
            : 'Shell command to execute. Will run via /bin/sh -c.',
        },
        timeout_seconds: {
          type: 'integer',
          description: 'Optional timeout in seconds (default 300, max 1800).',
        },
      },
      required: ['command'],
    };
  }

  requiresPermission(): boolean {
    return true;
  }

  // Scope an "allow session" approval to the exact command the user saw.
  // A different command re-prompts, so approving `id` once can't silently
  // license arbitrary later commands for the rest of the session. We do NOT
  // set noSessionCache: re-running the identical command should stay quiet.
  permissionHints(args: Record<string, unknown>): { cacheKey: string } {
    return { cacheKey: rewritePortableCommand(argString(args, 'command')) };
  }

  summarize(args: Record<string, unknown>): { summary: string; detail: string } {
    const cmd = rewritePortableCommand(argString(args, 'command'));
    const firstLine = cmd.split('\n', 1)[0] ?? '';
    const truncated = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
    return { summary: `${this.toolName}: ${truncated}`, detail: cmd };
  }

  async run(args: Record<string, unknown>, signal: AbortSignal, p: Prompter): Promise<string> {
    const originalCmd = argString(args, 'command');
    const cmdStr = rewritePortableCommand(originalCmd);
    if (!cmdStr) throw new Error('command is required');

    for (const re of DENY_PATTERNS) {
      if (re.test(originalCmd) || re.test(cmdStr)) {
        throw new Error(`command blocked by denylist (matched ${re.source})`);
      }
    }
    // The portability guards steer the model away from GNU-only Unix flags;
    // they are irrelevant (and their messages misleading) under PowerShell.
    if (!isWindows()) {
      for (const { re, message } of PORTABILITY_PATTERNS) {
        if (re.test(cmdStr)) {
          throw new Error(`command blocked for portability: ${message}`);
        }
      }
    }

    // --- PASR: Policy Engine check ---
    if (this.policy) {
      const urls = extractURLsFromCommand(originalCmd);
      if (urls.length > 0) {
        // URL-targeting commands: check each URL against scope.
        for (const url of urls) {
          try {
            const parsed = new URL(url);
            const hostname = parsed.hostname;
            const port = parsed.port
              ? Number.parseInt(parsed.port, 10)
              : parsed.protocol === 'https:'
                ? 443
                : 80;
            const protocol = (parsed.protocol === 'https:' ? 'https' : 'http') as 'http' | 'https';

            const decision = this.policy.evaluate({
              hostname,
              port,
              protocol,
              tool: 'shell',
            });

            if (decision.action === 'deny') {
              throw new Error(
                `policy denied: shell command targets ${hostname} — ${decision.reason}`,
              );
            }

            if (decision.action === 'require-approval') {
              const userDecision = await p.ask(
                {
                  tool: 'shell',
                  summary: `shell: policy requires approval for command targeting ${hostname}`,
                  detail: `command: ${originalCmd.slice(0, 200)}\nreason: ${decision.reason}`,
                },
                signal,
              );
              if (userDecision === 'deny') {
                throw new Error(`policy approval denied: ${decision.reason}`);
              }
            }
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('policy ')) throw e;
            // Not a valid URL or other error — skip policy check for this URL
          }
        }
      } else if (this.target) {
        // Non-URL commands: require approval when scope is configured
        // (AUTHORIZED_REMOTE mode). This prevents blind command execution
        // against targets not covered by URL-based scope checks.
        const scope = this.target.scope();
        if (scope.mode === 'AUTHORIZED_REMOTE') {
          const decision = this.policy.evaluate({
            hostname: this.target.baseURL() ? new URL(this.target.baseURL()).hostname : 'unknown',
            port: 0,
            protocol: 'http',
            tool: 'shell',
          });
          if (decision.action === 'deny') {
            throw new Error(
              `policy denied: shell command in AUTHORIZED_REMOTE mode — ${decision.reason}`,
            );
          }
          if (decision.action === 'require-approval') {
            const userDecision = await p.ask(
              {
                tool: 'shell',
                summary:
                  'shell: policy requires approval for non-URL command in AUTHORIZED_REMOTE mode',
                detail: `command: ${originalCmd.slice(0, 200)}\nreason: ${decision.reason}`,
              },
              signal,
            );
            if (userDecision === 'deny') {
              throw new Error(`policy approval denied: ${decision.reason}`);
            }
          }
        }
      }
    }

    const timeoutArg = args.timeout_seconds;
    let timeoutMs = DEFAULT_TIMEOUT_MS;
    if (typeof timeoutArg === 'number' && timeoutArg > 0) {
      timeoutMs = Math.min(timeoutArg * 1000, MAX_TIMEOUT_MS);
    }

    const { cmd, argv } = shellInvocation(this.shellPath, cmdStr);
    const result = await runWithCapture(cmd, argv, timeoutMs, signal);

    // --- PASR: Capture evidence ---
    if (this.evidenceStore) {
      try {
        const exitCodeMatch = result.match(/^exit: (-?\d+)/m);
        const exitCode = exitCodeMatch?.[1] ? Number.parseInt(exitCodeMatch[1], 10) : undefined;
        await this.evidenceStore.create({
          type: 'command',
          tool: this.toolName,
          command: originalCmd,
          output: result.slice(0, 4096),
          exitCode,
        });
      } catch {
        // Evidence capture is best-effort
      }
    }

    return result;
  }
}

export function rewritePortableCommand(command: string): string {
  // The macOS/BSD portability rewrite targets Unix tools (perl, grep). Under
  // PowerShell on Windows it would corrupt commands, so pass them through.
  if (isWindows()) return command;
  return command.replace(
    GREP_P_RE,
    (match, sep: string, lead: string, rawFlags: string, rawPattern: string, rest: string) => {
      const flags = rawFlags.trim().split(/\s+/).filter(Boolean);
      const shortFlags = flags
        .filter((flag) => /^-[A-Za-z]+$/.test(flag))
        .map((flag) => flag.slice(1))
        .join('');
      const hasPerlRegexp = flags.includes('--perl-regexp') || shortFlags.includes('P');
      if (!hasPerlRegexp) return match;

      const unsupportedFlags = shortFlags.replace(/[Piovh]/g, '');
      const hasUnsupportedLong = flags.some(
        (flag) => flag.startsWith('--') && flag !== '--perl-regexp',
      );
      if (unsupportedFlags || hasUnsupportedLong) return match;

      const pattern = unquoteShellToken(rawPattern);
      if (pattern == null) return match;

      const fileArgs = rest.trim();
      // Bail if an option-like token trails the pattern (e.g. `-A3`, `--color`).
      // grep context/format flags have no faithful perl one-liner equivalent;
      // emitting them as bareword perl "filenames" would silently corrupt the
      // command. Leaving the original `grep -P` lets the portability guard
      // surface a clear message instead of producing a broken rewrite.
      if (/(?:^|\s)-/.test(fileArgs)) return match;

      const regexFlags = shortFlags.includes('i') ? 'i' : '';
      const negate = shortFlags.includes('v');
      const extractOnly = shortFlags.includes('o');
      // Pass the user pattern as DATA via the environment, never inlined into
      // the Perl source. A regex built from an interpolated *variable* matches
      // its content as a pattern but does NOT run `@{[...]}` interpolation or
      // `(?{...})` code blocks (those require a literal regex / `use re 'eval'`),
      // so the portability rewrite can't become a code-execution primitive.
      const prelude = 'BEGIN { $p = $ENV{PF_GREP_PAT} } ';
      const code = extractOnly
        ? `${prelude}while (/$p/${regexFlags}g) { print "$&\\n" }`
        : negate
          ? `${prelude}print unless /$p/${regexFlags}`
          : `${prelude}print if /$p/${regexFlags}`;
      const perl = `PF_GREP_PAT=${shellQuote(pattern)} perl -ne ${shellQuote(code)}`;
      return `${sep}${lead}${perl}${fileArgs ? ` ${fileArgs}` : ''}`;
    },
  );
}

function unquoteShellToken(token: string): string | null {
  if (!token) return null;
  if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
  if (token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  }
  return token.replace(/\\(.)/g, '$1');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Extract HTTP/HTTPS URLs from a shell command string. Handles common
 * HTTP client commands (curl, wget, Invoke-WebRequest) and bare URLs.
 * Returns deduplicated URLs for Policy Engine validation.
 */
function extractURLsFromCommand(command: string): string[] {
  const urls = new Set<string>();

  // Match bare HTTP/HTTPS URLs
  const urlPattern = /https?:\/\/[^\s'"`|;&()]+/gi;
  for (const match of command.matchAll(urlPattern)) {
    try {
      const parsed = new URL(match[0]);
      urls.add(parsed.origin);
    } catch {
      // Invalid URL — skip
    }
  }

  // Match curl -u/--user style URLs (after flags)
  const curlPattern = /curl\s+(?:-[A-Za-z]+\s+)*(['"]?(https?:\/\/[^\s'"`]+))/gi;
  for (const match of command.matchAll(curlPattern)) {
    if (match[1]) {
      try {
        const parsed = new URL(match[1].replace(/['"]/g, ''));
        urls.add(parsed.origin);
      } catch {
        // Invalid URL — skip
      }
    }
  }

  // Match wget URLs
  const wgetPattern = /wget\s+(?:-[A-Za-z]+\s+)*(['"]?(https?:\/\/[^\s'"`]+))/gi;
  for (const match of command.matchAll(wgetPattern)) {
    if (match[1]) {
      try {
        const parsed = new URL(match[1].replace(/['"]/g, ''));
        urls.add(parsed.origin);
      } catch {
        // Invalid URL — skip
      }
    }
  }

  return [...urls];
}

/** BashTool is a PascalCase alias for ShellTool that uses /bin/bash. */
export class BashTool extends ShellTool {
  constructor(target?: Target, policy?: PolicyEngine, evidenceStore?: EvidenceStore) {
    super('/bin/bash', 'BashTool', target, policy, evidenceStore);
  }

  override description(): string {
    if (isWindows()) {
      return 'Run a command via PowerShell on the local machine (no /bin/bash on Windows; this falls back to the same PowerShell host as the shell tool). Same gating as the shell tool (per-command permission, denylist, output truncation).';
    }
    return "Run a bash command via /bin/bash -c on the local machine. Same gating as the shell tool (per-command permission, denylist, output truncation). Prefer this over `shell` when you need bash features like [[ ]] tests, process substitution <(...), arrays, or $'...' quoting.";
  }
}

function runWithCapture(
  cmd: string,
  argv: string[],
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<string> {
  return new Promise((resolveOut) => {
    const controller = new AbortController();
    let childPid = 0;
    const onParentAbort = () => {
      killProcessGroup(childPid);
      controller.abort();
    };
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(childPid);
      controller.abort();
    }, timeoutMs);
    let timedOut = false;
    timer.unref?.();

    // detached lets us kill the whole process group via negative PID on POSIX.
    // On Windows it would spawn a new console window and the group-kill model
    // differs, so we leave it attached and rely on taskkill /T below.
    const child = spawn(cmd, argv, { detached: !isWindows(), signal: controller.signal });
    childPid = child.pid ?? 0;
    // Retain the first AND last half of MAX_OUTPUT_BYTES per stream. Scanner /
    // curl verdicts usually land in the *tail* of the output, so a head-only
    // cap discarded exactly the bytes the model needs. Keeping both ends bounds
    // memory (a `yes`/`cat /dev/zero` flood can't grow the buffers past the cap)
    // while preserving the conclusion. We keep consuming all data so the child
    // isn't blocked on backpressure; the timeout still bounds total runtime.
    const stdoutBuf = new HeadTailBuffer(MAX_OUTPUT_BYTES);
    const stderrBuf = new HeadTailBuffer(MAX_OUTPUT_BYTES);
    child.stdout.on('data', (c: Buffer) => stdoutBuf.push(c));
    child.stderr.on('data', (c: Buffer) => stderrBuf.push(c));

    child.on('close', (code, sig) => {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
      const stdout = stdoutBuf.render();
      const stderr = stderrBuf.render();

      if (timedOut) {
        resolveOut(
          `exit: timeout after ${timeoutMs / 1000}s\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
        return;
      }

      const exitCode = code ?? (sig ? 128 + signalToInt(sig) : 0);
      let result = `exit: ${exitCode}\nstdout:\n${stdout}`;
      if (stderr) result += `\nstderr:\n${stderr}`;
      resolveOut(result);
    });

    child.on('error', (err) => {
      if (controller.signal.aborted && err.name === 'AbortError') return;
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
      const stdout = stdoutBuf.render();
      const stderr = stderrBuf.render();
      resolveOut(`exit: -1\nstdout:\n${stdout}\nstderr:\n${stderr}\nerror: ${err.message}`);
    });
  });
}

function killProcessGroup(pid: number): void {
  if (!pid) return;
  if (isWindows()) {
    // No POSIX signals/process groups on Windows; taskkill /T tears down the
    // PowerShell process and its child command tree.
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* best effort */
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/**
 * Bounded byte buffer that retains the first half and last half of `cap` bytes
 * of a stream, discarding the middle. Operates on Buffers (not pre-decoded
 * strings) so the cap is a true UTF-8 *byte* budget and the elision falls on
 * codepoint boundaries instead of mid-character. Memory is bounded to ~cap plus
 * one chunk regardless of total stream size.
 */
class HeadTailBuffer {
  private readonly half: number;
  private readonly head: Buffer[] = [];
  private headLen = 0;
  private readonly tail: Buffer[] = [];
  private tailLen = 0;
  private total = 0;

  constructor(private readonly cap: number) {
    this.half = Math.floor(cap / 2);
  }

  push(chunk: Buffer): void {
    this.total += chunk.length;
    let rest = chunk;
    if (this.headLen < this.half) {
      const room = this.half - this.headLen;
      if (rest.length <= room) {
        this.head.push(rest);
        this.headLen += rest.length;
        return;
      }
      this.head.push(rest.subarray(0, room));
      this.headLen += room;
      rest = rest.subarray(room);
    }
    this.tail.push(rest);
    this.tailLen += rest.length;
    // Drop whole leading chunks while doing so still leaves >= half bytes; the
    // final subarray() at render time trims any remaining overshoot exactly.
    while (this.tail.length > 1 && this.tailLen - (this.tail[0]?.length ?? 0) >= this.half) {
      const dropped = this.tail.shift();
      if (!dropped) break;
      this.tailLen -= dropped.length;
    }
  }

  render(): string {
    const headBuf = Buffer.concat(this.head);
    const tailFull = Buffer.concat(this.tail);
    const tailBuf =
      tailFull.length > this.half ? tailFull.subarray(tailFull.length - this.half) : tailFull;
    const retained = headBuf.length + tailBuf.length;
    if (this.total <= retained) {
      // Everything fit (head + tail cover the whole stream with no gap).
      return decodeUtf8Buffer(Buffer.concat([headBuf, tailBuf]));
    }
    const headStr = decodeUtf8Capped(headBuf, headBuf.length);
    const tailStr = decodeUtf8Tail(tailBuf);
    return `${headStr}\n[... truncated ${this.total - retained} bytes ...]\n${tailStr}`;
  }
}

function decodeUtf8Buffer(buf: Buffer): string {
  return buf.toString('utf8');
}

/**
 * Decode a buffer whose START may fall mid-codepoint (the head of the tail
 * slice). Skip up to 3 leading UTF-8 continuation bytes (0b10xxxxxx) so we don't
 * emit a leading U+FFFD; the buffer end is the real stream end, so no trailing
 * trim is needed.
 */
function decodeUtf8Tail(buf: Buffer): string {
  let start = 0;
  while (start < buf.length && start < 3 && (buf[start] ?? 0) >= 0x80 && (buf[start] ?? 0) < 0xc0) {
    start += 1;
  }
  return buf.subarray(start).toString('utf8');
}

function signalToInt(sig: NodeJS.Signals): number {
  // Best-effort mapping for the most common signals so the exit code is
  // still meaningful in the tool output.
  switch (sig) {
    case 'SIGINT':
      return 2;
    case 'SIGKILL':
      return 9;
    case 'SIGTERM':
      return 15;
    default:
      return 1;
  }
}
