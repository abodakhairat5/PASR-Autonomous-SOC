import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = 'PentesterFlow/agent';
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER = 1024 * 1024;

export interface UpdateResult {
  version: string;
  installDir?: string;
  output: string;
}

export async function runSelfUpdate(version = 'latest'): Promise<UpdateResult> {
  const repo = process.env.PENTESTERFLOW_REPO || DEFAULT_REPO;
  const normalizedVersion = normalizeVersion(version);
  const installDir = detectInstallDir();
  const env = {
    ...process.env,
    PENTESTERFLOW_REPO: repo,
    ...(normalizedVersion === 'latest' ? {} : { PENTESTERFLOW_VERSION: normalizedVersion }),
    ...(installDir ? { PENTESTERFLOW_INSTALL_DIR: installDir } : {}),
  };

  // Pin the installer to the requested release tag (immutable git ref) instead
  // of the mutable `main` branch whenever a concrete version is given, so
  // `/update v0.2.0` runs exactly the installer that shipped with that tag —
  // auditable and unchanging — rather than whatever currently sits on main
  // (L10). `latest` has no tag to pin to, so it still tracks main; the binary
  // it pulls is SHA-256 verified fail-closed by install.sh regardless.
  const ref = normalizedVersion === 'latest' ? 'main' : normalizedVersion;

  const output =
    process.platform === 'win32'
      ? await runWindowsInstaller(repo, ref, env)
      : await runUnixInstaller(repo, ref, env);

  return {
    version: normalizedVersion,
    installDir,
    output: compactOutput(output),
  };
}

function normalizeVersion(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'latest') return 'latest';
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

function detectInstallDir(): string | undefined {
  if (process.env.PENTESTERFLOW_INSTALL_DIR) return process.env.PENTESTERFLOW_INSTALL_DIR;
  const exe = basename(process.execPath).toLowerCase();
  if (exe === 'pentesterflow' || exe === 'pentesterflow.exe') return dirname(process.execPath);
  return undefined;
}

async function runUnixInstaller(
  repo: string,
  ref: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const scriptURL = `https://raw.githubusercontent.com/${repo}/${ref}/install.sh`;
  const script = await fetchText(scriptURL);
  const dir = await mkdtemp(join(tmpdir(), 'pentesterflow-update-'));
  const file = join(dir, 'install.sh');
  try {
    await writeFile(file, script, 'utf8');
    await chmod(file, 0o755);
    const { stdout, stderr } = await execFileAsync('sh', [file], {
      env,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return joinOutput(stdout, stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runWindowsInstaller(
  repo: string,
  ref: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const scriptURL = `https://raw.githubusercontent.com/${repo}/${ref}/install.ps1`;
  const command = [
    '$ErrorActionPreference = "Stop"',
    '$ProgressPreference = "SilentlyContinue"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
    `iex ((Invoke-WebRequest -Uri ${quotePowerShell(scriptURL)} -UseBasicParsing).Content)`,
  ].join('; ');

  const shell = process.env.ComSpec ? 'powershell.exe' : 'pwsh';
  const { stdout, stderr } = await execFileAsync(
    shell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      env,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    },
  );
  return joinOutput(stdout, stderr);
}

/**
 * Reject an installer URL that isn't https on the expected githubusercontent
 * host. The script is fetched then executed, so a tampered PENTESTERFLOW_REPO
 * must not be able to redirect the fetch to an attacker scheme/host (L10). TLS
 * guards the bytes in flight; this guards the destination.
 */
export function assertInstallerURL(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid installer URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`refusing to fetch installer over non-https URL: ${url}`);
  }
  if (parsed.hostname !== 'raw.githubusercontent.com') {
    throw new Error(`refusing to fetch installer from unexpected host: ${parsed.hostname}`);
  }
}

async function fetchText(url: string): Promise<string> {
  assertInstallerURL(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download failed: ${url} (${resp.status})`);
  return await resp.text();
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function joinOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
}

function compactOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= 8) return lines.join('\n');
  return lines.slice(-8).join('\n');
}
