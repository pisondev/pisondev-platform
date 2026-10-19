#!/usr/bin/env bash
#
# Installed as bin/receive on the VPS. The CI deploy key is bound to this command in
# authorized_keys, so whatever the key asks for, only this runs.
#
# Reads a release archive (deploy/build-release.sh) on stdin, backs up the database,
# switches `current` to the new release, recreates api and web, and waits until the app
# answers. If it does not, the previous release is put back and the deploy fails.

set -euo pipefail
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
cd "$ROOT"
PORT=$(grep -E '^WEB_PORT=' .env | cut -d= -f2)
KEEP=5

log() { printf '[receive %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# One deploy at a time.
exec 9>"$ROOT/.deploy.lock"
flock -w 900 9

mkdir -p releases
incoming=$(mktemp -d "$ROOT/releases/.incoming.XXXXXX")
trap 'rm -rf "$incoming"' EXIT

log "receiving archive"
head -c 400000000 | tar -xzf - -C "$incoming"
if [ ! -x "$incoming/api/api" ] || [ ! -f "$incoming/web/server.js" ] || [ ! -f "$incoming/VERSION" ]; then
  log "archive is incomplete, nothing changed"
  exit 1
fi
version=$(tr -cd 'a-zA-Z0-9._-' < "$incoming/VERSION" | head -c 40)
release="releases/$(date -u +%Y%m%dT%H%M%SZ)-${version:0:7}"
mv "$incoming" "$release"
trap - EXIT

if [ -n "$(docker compose ps -q --status running db)" ]; then
  log "backing up the database"
  "$ROOT/bin/backup" pre-deploy
fi

previous=$(readlink current 2>/dev/null || true)
ln -sfn "$release" current
log "switching to $release (was ${previous:-none})"
docker compose up -d db
docker compose up -d --force-recreate api web

healthy() {
  local i
  for i in $(seq 1 45); do
    if curl -fsS -m 5 "http://127.0.0.1:$PORT/api/v1/health" | grep -q "\"version\":\"$version\""; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if healthy; then
  log "version $version is live"
else
  log "version $version did not come up"
  docker compose logs --tail 60 api web || true
  if [ -n "$previous" ]; then
    log "rolling back to $previous"
    ln -sfn "$previous" current
    docker compose up -d --force-recreate api web
  fi
  exit 1
fi

# Keep the last releases, drop older ones.
ls -1d releases/*/ 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f current)" ] || rm -rf "$old"
done
