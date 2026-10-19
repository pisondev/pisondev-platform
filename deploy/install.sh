#!/usr/bin/env bash
#
# One-time and repeatable setup of the server side, run from this computer (Git Bash or
# MSYS2, where `ssh vps-hestia` signs in as user_pison). Safe to run again: it replaces
# compose.yaml, bin/receive and bin/backup, but never changes an existing .env.
#
#   deploy/install.sh                         install files, .env (first time), cron
#   deploy/install.sh --deploy-key key.pub    also authorize a CI key, bound to bin/receive
#
# The first .env is built from services/api/.env (Notion and Google values, allowlist) with
# production settings and a fresh database password. No value is printed.

set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${SSH_HOST:-vps-hestia}
DIR=projects/pisondev-platform
DEPLOY_KEY=""
[ "${1:-}" = "--deploy-key" ] && DEPLOY_KEY=${2:?--deploy-key needs a .pub file}

remote() { ssh -o BatchMode=yes "$HOST" "bash -s" -- "$@"; }

echo "== files"
remote <<EOF
set -euo pipefail
mkdir -p ~/$DIR/bin ~/$DIR/releases ~/$DIR/backups
chmod 700 ~/$DIR/backups
EOF
scp -q deploy/compose.yaml "$HOST:$DIR/compose.yaml"
scp -q deploy/receive.sh "$HOST:$DIR/bin/receive"
scp -q deploy/backup.sh "$HOST:$DIR/bin/backup"
remote <<EOF
chmod 755 ~/$DIR/bin/receive ~/$DIR/bin/backup
EOF

echo "== .env"
if remote <<EOF
test -f ~/$DIR/.env
EOF
then
  echo "exists, left unchanged"
else
  local_env=services/api/.env
  pick() { grep -E "^$1=" "$local_env" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//'; }
  for k in AUTH_ALLOWED_EMAILS GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET NOTION_TOKEN NOTION_TRANSACTIONS_DB NOTION_SUBSCRIPTIONS_DB NOTION_WEEKS_DB; do
    [ -n "$(pick $k)" ] || { echo "missing $k in $local_env"; exit 1; }
  done
  uid_gid=$(ssh -o BatchMode=yes "$HOST" 'echo "$(id -u) $(id -g)"')
  {
    sed -e "s/^APP_UID=.*/APP_UID=${uid_gid% *}/" \
        -e "s/^APP_GID=.*/APP_GID=${uid_gid#* }/" \
        -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
        -e 's/[[:space:]]*#.*$//' deploy/server.env.example | grep -E '^[A-Z_]+=' | grep -vE '^(AUTH_ALLOWED_EMAILS|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|NOTION_TOKEN|NOTION_TRANSACTIONS_DB|NOTION_SUBSCRIPTIONS_DB|NOTION_WEEKS_DB)='
    for k in AUTH_ALLOWED_EMAILS GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET NOTION_TOKEN NOTION_TRANSACTIONS_DB NOTION_SUBSCRIPTIONS_DB NOTION_WEEKS_DB; do
      echo "$k=$(pick $k)"
    done
  } | ssh -o BatchMode=yes "$HOST" "umask 077 && cat > ~/$DIR/.env"
  echo "written (mode 600)"
fi

echo "== cron"
remote <<EOF
line="15 3 * * * \$HOME/$DIR/bin/backup daily >> \$HOME/$DIR/backups/cron.log 2>&1"
(crontab -l 2>/dev/null | grep -vF "$DIR/bin/backup"; echo "\$line") | crontab -
echo "daily backup at 03:15"
EOF

if [ -n "$DEPLOY_KEY" ]; then
  echo "== deploy key"
  key=$(cat "$DEPLOY_KEY")
  remote <<EOF
set -euo pipefail
# Append only: rewriting authorized_keys risks locking out the account's own login key.
if grep -qF "$DIR/bin/receive" ~/.ssh/authorized_keys 2>/dev/null; then
  echo "a key bound to bin/receive exists already; to rotate it, edit authorized_keys by hand"
else
  echo 'command="/home/user_pison/$DIR/bin/receive",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $key' >> ~/.ssh/authorized_keys
  echo "authorized, bound to bin/receive"
fi
EOF
fi
echo "done"
