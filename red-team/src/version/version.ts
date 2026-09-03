// Version is injected by tsup at build time via `--define`. For dev runs
// (`tsx src/cli/index.ts`) it falls back to 'dev'. The version string appears in /settings, the
// banner, and logs.

declare const __BUILD_VERSION__: string | undefined;

const FALLBACK = 'dev';

function readBuildVersion(): string {
  try {
    if (typeof __BUILD_VERSION__ === 'string' && __BUILD_VERSION__.length > 0) {
      return __BUILD_VERSION__;
    }
  } catch {
    // __BUILD_VERSION__ undefined in dev — fall through.
  }
  return FALLBACK;
}

export const VERSION: string = readBuildVersion();

export function describe(): string {
  return `pentesterflow ${VERSION}`;
}
