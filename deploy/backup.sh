#!/usr/bin/env bash
#
# Installed as bin/backup on the VPS. Dumps the database to backups/<label>-<time>.sql.gz
# and keeps the newest 14 dumps per label. Run daily by cron and before every deploy.
#
#   bin/backup [label]      label defaults to "daily"

set -euo pipefail
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
cd "$ROOT"
label=${1:-daily}
mkdir -p backups
set -a; . ./.env; set +a

file="backups/$label-$(date +%Y%m%dT%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner | gzip > "$file.part"
mv "$file.part" "$file"
chmod 600 "$file"
echo "backup written: $file ($(du -h "$file" | cut -f1))"

ls -1t backups/"$label"-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
