#!/usr/bin/env bash
set -euo pipefail

# Creates deployment zips for each Lambda under dist/lambdas/.
# Each zip includes the Lambda folder files and node_modules from the repo root.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/lambdas"

mkdir -p "$DIST_DIR"
cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  echo "node_modules not found. Running npm install first."
  npm install
fi

for lambda_dir in lambdas/*; do
  [[ -d "$lambda_dir" ]] || continue
  name="$(basename "$lambda_dir")"
  workdir="/tmp/${name}-lambda-package"
  rm -rf "$workdir"
  mkdir -p "$workdir"

  cp -R "$lambda_dir"/* "$workdir"/
  cp package.json package-lock.json "$workdir"/ 2>/dev/null || true
  cp -R node_modules "$workdir"/

  (cd "$workdir" && zip -qr "$DIST_DIR/${name}.zip" .)
  echo "Created $DIST_DIR/${name}.zip"
done
