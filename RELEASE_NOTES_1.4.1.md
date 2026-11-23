# WhelkMail 1.4.1

**Fixes the Deploy to Cloudflare flow: automatic D1 provisioning, custom Worker names, and only the two required secrets.**

WhelkMail 1.4.1 is a patch release for the Workers deployment. It does not add a database migration and does not change the Pages or Docker runtime behavior.

## Fixes

### Deploy to Cloudflare no longer leaves an empty Worker

The button could create the Worker resource and then fail while looking it up with `WorkerResource.getWorkerResult: response missing default_environment.script`. The underlying deploy had failed, so no script was uploaded. The root cause was the placeholder `database_id` in `wrangler.jsonc`: the setup treated it as an existing database instead of provisioning one.

- `wrangler.jsonc` now has **no `database_id`**. The Deploy to Cloudflare flow provisions D1 from the binding, writes the real id into the new repository, and then deploys. `wrangler deploy` can also auto-provision it for CLI use.
- Existing databases keep working: add their id locally, or use the dashboard/CLI as before.

### Custom Worker names are honored

- The deploy now runs through `scripts/deploy.mjs`, which passes `--name` from `WRANGLER_CI_OVERRIDE_NAME` (set by the Deploy to Cloudflare flow), then `WORKER_NAME`, then `CF_NAME`.
- CLI example: `WORKER_NAME=my-mail npm run deploy`.
- Invalid names fail with a clear message before Wrangler starts.

### The setup only requires APP_PASSWORD and TOKEN_ENC_KEY

- `.dev.vars.example` now leaves only `APP_PASSWORD` and `TOKEN_ENC_KEY` active. Google, Microsoft, relay, VAPID, `CRON_SECRET` and the other optional values are commented out.
- The Deploy to Cloudflare setup no longer blocks on Google ID/secret or other integrations you have not configured.
- Add optional secrets later in the dashboard or with `wrangler secret put`.

### CLI database setup

- New documented command: `npx wrangler d1 create mail-client --binding DB --update-config`. It creates the database and writes its id into the local `wrangler.jsonc`.
- Do not commit your real `database_id`; the public repository is intentionally generic.

## Upgrade guide

There are no database migrations in 1.4.1.

### Cloudflare Workers

```bash
git fetch --tags && git checkout 1.4.1
npm ci
npm run deploy
```

New database only: after the first deploy, run `npm run db:init:workers:remote` once. Existing databases need no schema command.

### Cloudflare Pages

```bash
git fetch --tags && git checkout 1.4.1
npm ci
npm run deploy:pages
```

Keep the existing D1/R2 bindings and secrets. Remove any legacy local `wrangler.toml`: Pages reads the tracked root `wrangler.jsonc`.

### Docker

```bash
git pull
cd deploy/docker
docker compose up -d --build
```

No database migration is required; the startup migration runner is a no-op.

## Behavior changes to review

- **`wrangler.jsonc` has no `database_id`.** The Deploy flow provisions D1 and writes the id into your new repository. For an existing database, add the id locally and keep it out of commits.
- **`npm run deploy` uses `scripts/deploy.mjs`.** It forwards the Worker name from `WRANGLER_CI_OVERRIDE_NAME`, `WORKER_NAME` or `CF_NAME` and then runs Wrangler.
- **Only two secrets are required during setup.** `CRON_SECRET` is optional; without it, notifications and automatic background sync stay off until you add it.
- **Deploy wrapper validation.** Worker names must use lowercase letters, digits and dashes, up to 63 characters, with no leading or trailing dash.

## Verification

- TypeScript project references and the frontend build pass.
- 322 tests pass, including API route coverage, the SQLite D1 adapter, S3 Signature V4, the Node mail socket and the Worker-name resolver.
- `wrangler deploy --dry-run` passes with the D1 binding but no `database_id`.
- `wrangler dev` and `wrangler pages dev` serve `/api/health` and the SPA with D1 auto-provisioning.
- The docs site builds successfully with the updated deployment instructions.
