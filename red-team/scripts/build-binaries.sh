#!/usr/bin/env bash
# Build single-file executables via Bun for the platforms pentesters
# care about. Run after `npm install` + `npm run build`. Outputs land
# in dist-bin/. Bun must be installed (curl -fsSL https://bun.sh/install | bash).

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found — install from https://bun.sh first" >&2
  exit 1
fi

mkdir -p dist-bin

TARGETS=(
  "bun-darwin-arm64:pentesterflow-darwin-arm64"
  "bun-darwin-x64-baseline:pentesterflow-darwin-x64"
  "bun-linux-x64-baseline:pentesterflow-linux-x64"
  "bun-linux-arm64:pentesterflow-linux-arm64"
)

for entry in "${TARGETS[@]}"; do
  IFS=':' read -r target name <<< "$entry"
  echo "==> building $name"
  bun build src/cli/index.ts \
    --compile \
    --target "$target" \
    --outfile "dist-bin/$name"
done

ls -la dist-bin/
