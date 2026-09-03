import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const version: string = JSON.parse(readFileSync('./package.json', 'utf8')).version;

export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    'browser-mcp': 'src/browser/mcpServer.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  // Bake the package.json version into the bundle so `--version` reports it.
  // Stamp package.json from the git tag in CI before building a release.
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
  },
  clean: true,
  splitting: false,
  shims: false,
  sourcemap: true,
  // Bundle our own code; leave Ink's optional devtools and other peer-
  // optional deps external so esbuild doesn't fail on unresolved
  // requires. The npm install pulls dependencies in via package.json.
  external: ['react-devtools-core', 'yoga-wasm-web', 'bufferutil', 'utf-8-validate'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
