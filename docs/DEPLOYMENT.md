# Deployment targets

One repository, three deployment targets. The API handlers, security middleware
and mail logic are shared; only a thin entrypoint and the storage/transport
adapters differ.

| | Cloudflare Workers (default) | Cloudflare Pages | Docker / self-hosted |
| --- | --- | --- | --- |
| Entrypoint | `server/entries/workers.ts` | `functions/api/**` | `server/entries/node.ts` |
| Database | D1 (`DB`) | D1 (`DB`) | SQLite in `/data` (`node:sqlite`) |
| Object storage | R2 (`BUCKET`), Google Drive | R2, Google Drive | S3/MinIO (`S3_*`), Google Drive |
| IMAP/SMTP sockets | `cloudflare:sockets` | `cloudflare:sockets` | `node:net` / `node:tls` |
| Background cron | Worker triggers | separate `worker/` cron | built-in scheduler |
| Static files | Workers Assets | Pages | Node static server |

The frontend (`npm run build`) is the same for all three.

## Common secrets

| Name | Required | Notes |
| --- | --- | --- |
| `APP_PASSWORD` | yes | login password |
| `TOKEN_ENC_KEY` | yes | 32 random bytes, base64 |
| `CRON_SECRET` | Pages only | authenticates the separate `worker/` cron that calls `/api/cron/notifications`. The Workers entry runs the same work in-process and the Docker scheduler generates one when it is missing, so neither needs it |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Drive archive + Google OAuth mail |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | optional | Microsoft OAuth mail |
| `RELAY_PROVIDER`, `RELAY_API_KEY`, `RELAY_API_SECRET` | optional | send-only relay accounts |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional | Web Push |
| `UPDATE_CHECK` | optional | set to `off` to disable the GitHub release check |

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 1. Cloudflare Workers (default)

The [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/WhelkMail/WhelkMail)
button deploys the Worker directly, provisions the D1 database from the binding
and asks only for the two required secrets declared in `.dev.vars.example`
(`APP_PASSWORD`, `TOKEN_ENC_KEY`). The OAuth/relay/VAPID values are commented out
and can be added later. The scheduled work needs no secret here: `scheduled()`
runs it in-process. For a CLI deploy:

```bash
npm install
npx wrangler d1 create mail-client --binding DB --update-config
npm run db:init:workers:remote

npx wrangler secret put APP_PASSWORD
npx wrangler secret put TOKEN_ENC_KEY

npm run deploy
```

`wrangler.jsonc` intentionally has no `database_id`: the Deploy to Cloudflare
flow provisions D1 and writes its id into the new repository, and `wrangler
deploy` can auto-provision it for CLI use. If you create the database first, use
`--update-config` as above and keep the id out of commits. For a custom Worker
name, the Deploy flow sets `WRANGLER_CI_OVERRIDE_NAME`; for CLI use
`WORKER_NAME=my-worker npm run deploy`.

`npm run deploy` builds the frontend and runs `wrangler deploy`. Static assets
are served by Workers Assets; `assets.run_worker_first` sends `/api/*` to the
Worker, and `not_found_handling` keeps SPA deep links working.

The Worker's `[triggers] crons` block runs the notification/sync pass directly,
so the separate `worker/` deployment is **not** needed on this target.

Local development:

```bash
npm run db:init:workers:local
npm run dev            # Vite on :5173
npm run dev:workers    # Worker + local D1/R2 on :8787
```

R2 is optional: uncomment the `r2_buckets` block in `wrangler.jsonc`
after creating the bucket. Without it, accounts can still use Google Drive, an
IMAP mailbox, or the provider itself for sent copies.

## 2. Cloudflare Pages (existing installations)

Pages deployments keep using native file routing under `functions/api`; the
only runtime change is that `functions/api/_middleware.ts` registers the
Cloudflare socket implementation for the mail clients. Existing projects need no
configuration change and no data migration: keep the same D1 database, R2
bucket and secrets.

New Pages deployment:

```bash
npx wrangler d1 create mail-client
# paste the id into wrangler.jsonc for local CLI work, or set the DB binding
# in the Pages dashboard
npm run db:init:remote
npm run deploy:pages
```

Pages does not support custom configuration paths. If an installation still has
a local `wrangler.toml`, remove it: the tracked `wrangler.jsonc` is the shared
local config, while the Pages dashboard remains the source of truth for
production bindings.

The full dashboard walkthrough, custom domains and OAuth setup remain in
[CLOUDFLARE.md](CLOUDFLARE.md). On Pages, background work (sync, notifications,
filters, vacation responder) runs through the separate cron worker:

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
# set APP_URL to the Pages URL
npm run cron:deploy
```

## 3. Docker / any VPS

```bash
cd deploy/docker
cp .env.example .env
# edit .env: APP_PASSWORD, TOKEN_ENC_KEY, PUBLIC_ORIGIN
docker compose up -d --build
```

Open `http://<host>:8787` or put Caddy/Traefik/nginx in front and set
`PUBLIC_ORIGIN=https://mail.example.com`.

The image uses Node 24, the built-in `node:sqlite` module and a bundled server
(`dist-server/server.mjs`), so the runtime stage has no `node_modules` and no
native build step.

### Data and backups

The database lives in the volume mounted at `/data` (default
`/data/whelkmail.sqlite`). Back up that volume; it contains accounts, encrypted
credentials, sessions, contacts, filters and the metadata mirror.

Schema creation and migrations run automatically on startup; an empty database
is initialised from `db/schema.sql`, an existing one receives pending files from
`db/migrations`.

### Object storage

S3-compatible storage is optional. Set:

```env
S3_ENDPOINT=http://minio:9000
S3_BUCKET=whelkmail
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

`docker compose --profile s3 up -d --build` also starts MinIO; create the bucket
once from its console (`http://<host>:9001`, credentials from `.env`). Any
S3-compatible service works (MinIO, AWS S3, Backblaze B2, Cloudflare R2 through
its S3 API).
The UI labels the driver **S3 / R2**; the stored driver name remains `r2`, so
moving a database between R2 and S3 keeps existing rows readable as long as the
objects are copied to the new bucket.

### Cron and proxy

The container runs the notification/sync scheduler every minute
(`CRON_ENABLED=true`). It calls the same authenticated endpoint as the
Cloudflare targets, using `CRON_SECRET`; if the variable is missing a random
per-process secret is generated, so the internal scheduler still works.

Behind a reverse proxy, keep `PUBLIC_ORIGIN` aligned with the public URL: OAuth
callbacks and secure cookies are derived from it. The proxy should also forward
`X-Forwarded-Proto` and `X-Forwarded-Host` if you prefer not to set
`PUBLIC_ORIGIN`.

Run a single container/instance with SQLite. Everything is local to the process
except IMAP/SMTP, OAuth and the optional S3 bucket.

## Verifying a deployment

The health endpoint is public and reports which optional backends are
configured:

```bash
curl -s https://mail.example.com/api/health
```

Then sign in, add an account under Settings → Accounts, and use **Test
connection**. The first mailbox open starts the initial metadata sync.

### Moving a configuration to another installation

**Settings → System → Configuration export and import** writes a single JSON
file with accounts, filters, labels, contacts, notification preferences and app
settings. Account secrets (IMAP/SMTP passwords, OAuth tokens, relay and Drive
keys) are decrypted on export and the whole file is encrypted with a passphrase
you choose (PBKDF2-SHA256 + AES-256-GCM), so it can be restored on a deployment
that uses a different `TOKEN_ENC_KEY`.

The import replaces the target installation's configuration, re-encrypts the
secrets with its own `TOKEN_ENC_KEY` and clears the local mail mirror (mail stays
on the providers and is rebuilt by the next sync). Sessions, two-factor settings
and the R2/Drive archive are left untouched. The passphrase cannot be recovered:
without it the file cannot be opened.

The key derivation runs inside the Worker, so on a Workers Free plan its CPU
budget can be too small for the export/import request; use Docker or a Workers
Paid plan when the file is large.

## Updating

- **Workers:** pull the release, update `wrangler.jsonc` if the release note
  says so, run `npm run db:migrate:workers:remote`, then `npm run deploy`.
- **Pages:** pull, run `npm run db:migrate:remote`, deploy the Pages project.
- **Docker:** pull, `docker compose up -d --build`. Migrations run on start.
