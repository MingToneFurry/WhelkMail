# WhelkMail

A self-hosted webmail client for mailboxes you already own.

WhelkMail runs entirely on Cloudflare Pages and Workers. It is **not** a mail server: it connects to your providers over IMAP and SMTP, so your messages, sent copies, drafts and attachments stay on your mail provider. A separate "send-only" account type supports domains that have no SMTP, using an HTTP relay and an optional Google Drive or Cloudflare R2 archive.

## Features

- Familiar webmail layout: message list with a full-width reading view and an optional right-side reading pane
- Multiple accounts in one view, with colored address labels and quick filters
- Gmail-style labels shared across all accounts: create them from the sidebar, apply them to any message, and open a label view that collects labeled messages across Inbox, Sent and Drafts
- Per-account incoming label: choose it while adding an account (or in Settings) so every incoming message of that account is labeled automatically
- Gmail-style filters in Settings: shared across accounts, match From/To/Subject/words/attachments and apply one or more labels automatically to incoming messages
- Contacts: shared address book with search, edit, CSV import/export and recipient autocomplete in To/Cc/Bcc
- IMAP metadata sync into D1: incremental, chunked and resumable, with per-account status in Settings, automatic resume of partial syncs, and label transfer when messages move between folders.
- Optional automatic background sync per account: the cron worker advances Inbox, Sent and Drafts every 5 minutes in bounded chunks.
- Optional archive of IMAP bodies and attachments on R2 or Google Drive: when enabled per account, the sync stores the raw EML and opening/downloading messages can use the archive instead of the provider.
- Gmail-style filter actions: a filter can apply labels and/or forward matching incoming messages, with the original EML attached, anti-loop headers and per-filter forward logs.
- Optional provider cleanup after archiving: archived incoming messages are moved to the provider Trash instead of being permanently deleted, with explicit opt-in and logs.
- Signatures: choose one shared signature for every account or a different signature per account; inserted automatically in new messages and replies
- Installable PWA with an app-shell service worker and Web Push notifications, including per-account/folder preferences
- Mobile layout with a collapsible sidebar drawer
- Inbox, Sent and Drafts, with autosave and reopenable drafts
- Sending through each account's own SMTP server
- Drafts saved on the provider (IMAP `\Drafts`) or on Drive/R2 for relay accounts
- Attachment indicators in lists via `BODYSTRUCTURE`, without downloading bodies
- Google OAuth2 or app passwords for Google accounts
- Microsoft OAuth2 (XOAUTH2) for Outlook / Microsoft 365
- Password / app-password authentication for Yahoo, iCloud and generic IMAP
- MIME handling with attachments, streamed on demand
- English by default, Italian available; extensible dictionary
- MIT licensed

## Stack

- React 19 + Vite 8 + TypeScript + Tailwind CSS
- Cloudflare Pages Functions (Workers runtime)
- Cloudflare D1 for accounts and metadata
- `cloudflare:sockets` for IMAP/SMTP
- Optional Cloudflare R2 or Google Drive for send-only accounts
- `postal-mime` for MIME parsing

## Quick start

Requirements: Node.js 22+, npm.

```bash
npm install
npm run db:local
```

If you already have a local database created before labels/signatures, run:

```bash
npm run db:migrate:local
```

If earlier migrations were already applied and you only need the filter-forwarding changes, run `npm run db:migrate:local:11`.

Create `.dev.vars` in the project root:

```env
APP_PASSWORD=change-me
TOKEN_ENC_KEY=<32-byte base64 key>
```

Generate the key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Start the app in two terminals:

```bash
npm run dev       # Vite on http://localhost:5173
npm run dev:api   # Pages Functions on http://localhost:8788
```

Open `http://localhost:8788` and sign in with `APP_PASSWORD`.

## Deploy on Cloudflare

The complete guide — dashboard clicks, exact commands, bindings, secrets, OAuth apps and troubleshooting — is in [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).

Short version:

1. Create the database and copy its ID into `wrangler.toml`:
   ```bash
   npx wrangler d1 create mail-client
   ```
   The D1 database keeps the legacy `mail-client` name so existing data keeps working; the Pages project is named `whelkmail`.
2. Create a Pages project from GitHub. Build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Root directory: `/`
   - Environment variable: `NODE_VERSION=22`
3. Add the D1 binding `DB` and the secrets `APP_PASSWORD` and `TOKEN_ENC_KEY`.
4. Apply the schema:
   ```bash
   npm run db:remote
   ```
   If the database already existed before labels and signatures were added, also run the additive migrations:
   ```bash
   npm run db:migrate:remote
   ```
5. Optional Web Push:
   ```bash
   npm run vapid
   ```
   Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and a random `CRON_SECRET` to the Pages project, then set the same `CRON_SECRET` on the cron worker and deploy it with `npm run cron:deploy`.
6. Deploy and open the Pages URL.

A Workers Paid plan is recommended: IMAP/SMTP TLS handshakes could exceed the free plan CPU budget.

## Configuration

IMAP/SMTP accounts need no central mail configuration: each account stores its own servers and credentials.

Optional deployment settings:

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Drive archive for relay accounts |
| `GOOGLE_MAIL_CLIENT_ID` / `GOOGLE_MAIL_CLIENT_SECRET` | Google OAuth for IMAP/SMTP |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT` | Outlook / Microsoft 365 OAuth |
| `RELAY_PROVIDER` / `RELAY_API_KEY` / `RELAY_API_SECRET` | Deployment-wide relay fallback |
| `MAILGUN_DOMAIN` / `MAILGUN_REGION` | Mailgun relay fallback |
| `BUCKET` (R2 binding) | Optional R2 archive |

Relay credentials can also be entered per account in the UI and are encrypted at rest.

## Documentation

- [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) — complete Cloudflare deployment and usage guide
- [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) — architecture, security, mailbox behavior and limitations

## Limitations

- No IMAP IDLE: the list refreshes on navigation, after sending, or on manual reload. Sync can be started manually from Settings or enabled per account for the cron worker; new-mail notifications come from the same worker.
- Web Push requires VAPID keys, the separate cron worker under `worker/`, and the `CRON_SECRET` secret shared by Pages and the worker.
- HTML bodies are displayed as extracted text; remote content is never loaded.
- The live fetch returns the newest 30 messages per folder; it is merged with up to 100 mirrored messages. Search is client-side over the loaded set.
- A label view uses the D1 mirror when available and falls back to fetching the labeled UIDs from the provider.
- Filters run when the inbox is loaded and when the cron worker syncs new inbox messages. Matching uses From/To/Subject/snippet, not the full message body.
- Forwarding and provider deletion run from the cron worker, so they require the same setup as Web Push. They only act on new incoming messages detected after the initial sync.
- No alias-based "send as" yet: the sender is the account address.
- Single shared `APP_PASSWORD`; this is a personal / small-team tool, not a multi-tenant service.
- Workers Paid is recommended because IMAP/SMTP TLS handshakes could exceed the free plan CPU budget.
- Google OAuth uses the restricted `https://mail.google.com/` scope. A public production app needs Google verification (CASA); personal/testing apps can use OAuth in Testing mode, where refresh tokens expire after 7 days. App passwords remain available as an alternative.

## License

MIT. See [LICENSE](LICENSE).
