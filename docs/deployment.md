# Deployment

<https://assistant.pisondev.com> runs on the shared VPS that also serves the tierratie.com
sites, the same way they do: containers that listen on the machine only, nginx of
HestiaCP with a Let's Encrypt certificate in front, and Cloudflare in front of nginx.

```
browser ─HTTPS─▶ Cloudflare (proxied, SSL Full strict)
                   └─HTTPS─▶ nginx, HestiaCP (assistant.pisondev.com, template pisondev-assistant)
                               └─▶ 127.0.0.1:3040 ─▶ web  (Next.js standalone, node:22-alpine)
                                                      └─/api─▶ api (Go binary, alpine) ─▶ db (postgres:17-alpine)
```

Only `web` is published, and only on loopback. `api` and `db` are reachable on the Docker
network alone.

## Deploying

Every push to `main` that passes the `guards`, `api` and `web` jobs runs the `deploy` job
of `.github/workflows/ci.yml`. Pull requests are checked, never deployed. Deploys run one at
a time.

1. `deploy/build-release.sh` builds the API as a static Linux binary (version = commit) and
   the web app as a Next.js standalone server with `/api` rewritten to `http://api:8100`,
   then packs both into `dist/release.tar.gz`.
2. The job pipes the archive over SSH. The deploy key can only run `bin/receive`.
3. `bin/receive` unpacks it into `releases/<time>-<commit>`, dumps the database to
   `backups/pre-deploy-*.sql.gz`, points `current` at the new release, recreates `api` and
   `web`, and waits until `/api/v1/health` reports the new commit. If it does not, it points
   `current` back and fails the job. The five newest releases are kept.
4. The job checks `https://assistant.pisondev.com/api/v1/health` for the new commit.

Migrations run when the API starts. They are forward-only: a rollback restores the
previous binary, not the previous schema; the pre-deploy dump is the way back for data.

## On the server

Everything lives in `~/projects/pisondev-platform/` of `user_pison`:

| Path | Content | Changed by a deploy |
|---|---|---|
| `.env` | Production settings and secrets, mode 600 ([template](../deploy/server.env.example)) | no |
| `compose.yaml` | Copy of `deploy/compose.yaml` | no (`install.sh`) |
| `bin/receive`, `bin/backup` | Copies of `deploy/receive.sh`, `deploy/backup.sh` | no (`install.sh`) |
| `releases/`, `current` | Unpacked releases, symlink to the live one | yes |
| `backups/` | `daily-*` (cron 03:15) and `pre-deploy-*` dumps, 14 of each | yes |
| volume `pisondev_db-data` | PostgreSQL data | no |

```bash
ssh vps-hestia 'cd ~/projects/pisondev-platform && docker compose ps'
ssh vps-hestia 'cd ~/projects/pisondev-platform && docker compose logs --tail 100 api'
ssh vps-hestia 'cd ~/projects/pisondev-platform && docker compose exec api /app/api sync --dry-run'
```

To change a setting: edit `.env` on the server, then
`docker compose up -d --force-recreate api web`.

To go back by hand to the previous release:

```bash
cd ~/projects/pisondev-platform
ln -sfn "$(ls -1d releases/*/ | sort | tail -2 | head -1)" current
docker compose up -d --force-recreate api web
```

To restore a dump: `gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -U pisondev -d pisondev`
into an emptied database (stop `api` first).

## The deploy key

GitHub Actions signs in as `user_pison` with its own key, kept in the secret
`VPS_SSH_KEY`. The server's host key is pinned in `VPS_KNOWN_HOSTS`; the variables
`VPS_HOST`, `VPS_USER` and `PUBLIC_ORIGIN` say where to go. In `~/.ssh/authorized_keys`:

```
command="/home/user_pison/projects/pisondev-platform/bin/receive",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 ... github-actions-deploy@pisondev-platform
```

Whatever the job sends, the server runs `bin/receive` and nothing else. A leaked key can
replace the app with another build, but cannot open a shell or read `.env`. To rotate:
create a key, `gh secret set VPS_SSH_KEY < key`, and swap the line in `authorized_keys`
by hand.

## One-time setup (done 20 Oct 2026)

1. **Domain**: `pisondev.com` registered at Hostinger, nameservers moved to Cloudflare
   (`garrett.ns.cloudflare.com`, `lovisa.ns.cloudflare.com`), zone on the Free plan in the
   pison.gm.dev Cloudflare account. DNSSEC is off at Hostinger.
2. **Cloudflare**: `A assistant → 103.87.67.77`, proxied; SSL/TLS mode Full (strict). The
   parking records for `pisondev.com` and `www` came from the scan and can go once a public
   site exists.
3. **HestiaCP** (as root, through the admin account `bestuana10`, alias `prinx`): nginx
   template `pisondev-assistant` (`.tpl` and `.stpl` in
   `/usr/local/hestia/data/templates/web/nginx/php-fpm/`, copies of `music-assistant`
   proxying to `127.0.0.1:3040`), then

   ```bash
   v-add-web-domain user_pison assistant.pisondev.com 103.87.67.77 no none
   v-change-web-domain-tpl user_pison assistant.pisondev.com pisondev-assistant no
   v-add-letsencrypt-domain user_pison assistant.pisondev.com
   v-add-web-domain-ssl-force user_pison assistant.pisondev.com
   v-add-web-domain-ssl-hsts user_pison assistant.pisondev.com
   nginx -t && systemctl reload nginx
   ```

   The certificate was issued while the record was DNS-only; renewals work through the
   proxy over HTTP.
4. **Server**: `deploy/install.sh --deploy-key key.pub` from this computer: files, `.env`
   built from `services/api/.env` with production values and a random database password,
   the daily backup cron, and the restricted key.
5. **GitHub**: secrets `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` (`ssh-keyscan -t ed25519`, compared
   with the fingerprint this computer trusts), variables `VPS_HOST`, `VPS_USER`,
   `PUBLIC_ORIGIN`.
6. **Google**: in the `pisondev-platform` OAuth client, origin `https://assistant.pisondev.com`
   and redirect `https://assistant.pisondev.com/api/v1/auth/google/callback`.
7. **Notion webhook**: see [notion-sync.md](notion-sync.md#webhook-after-deployment); the
   token is printed with
   `docker compose exec api /app/api webhook-token`.

## Local and production together

Production runs `SYNC_MODE=full` and is the only writer. Local development stays on
`SYNC_MODE=pull`, so both databases follow Notion without two writers racing.
