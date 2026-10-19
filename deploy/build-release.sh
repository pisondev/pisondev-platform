#!/usr/bin/env bash
#
# Builds the release archive deployed to the VPS: the Go API as a static Linux binary and
# the Next.js standalone server. Runs in CI (Linux). Output: dist/release.tar.gz
#
#   deploy/build-release.sh [version]     version defaults to the current commit

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
VERSION=${1:-$(git rev-parse HEAD)}
OUT=$ROOT/dist/release

rm -rf "$ROOT/dist"
mkdir -p "$OUT/api" "$OUT/web"

echo "== api"
(
  cd services/api
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -tags timetzdata \
    -ldflags "-s -w -X main.version=$VERSION" -o "$OUT/api/api" ./cmd/api
)

echo "== web"
(
  cd apps/assistant-web
  # Rewrites are fixed at build time: /api goes to the API service on the Docker network.
  API_ORIGIN=http://api:8100 pnpm build
  cp -R .next/standalone/. "$OUT/web/"
  mkdir -p "$OUT/web/.next"
  cp -R .next/static "$OUT/web/.next/static"
  if [ -d public ]; then cp -R public "$OUT/web/public"; fi
)

echo "$VERSION" > "$OUT/VERSION"
tar -C "$OUT" -czf "$ROOT/dist/release.tar.gz" .
echo "built dist/release.tar.gz ($(du -h "$ROOT/dist/release.tar.gz" | cut -f1)), version $VERSION"
