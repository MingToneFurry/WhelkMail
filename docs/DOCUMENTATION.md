# Mail — Technical Documentation

This document covers the architecture, security model, mailbox behavior and storage.

> **Deploying or using it on Cloudflare?** Start with the dedicated step-by-step guide: [CLOUDFLARE.md](CLOUDFLARE.md). It covers dashboard clicks, exact commands, bindings, secrets, OAuth setup, verification and troubleshooting.

## 1. Scope

Mail is a **webmail client**, not a mail server.

- It connects to existing mailboxes through IMAP and SMTP.
- It does not receive mail directly, does not run an MTA, and does not listen on ports 25/143/993/465/587.
- It does not create mailboxes. Thunderbird and mobile clients can keep connecting to the same provider independently.
- For domains with no SMTP, a separate **relay account** type sends through an HTTP email API and archives sent copies/drafts on Google Drive or Cloudflare R2.

## 2. Architecture

```
Browser (React/Vite)
        |
        | HTTPS, same-origin /api
        v
Cloudflare Pages Functions (Workers runtime)
        |
        +-- D1 (accounts, relay archive metadata, drafts)
        +-- IMAP over cloudflare:sockets (TLS / STARTTLS)
        +-- SMTP over cloudflare:sockets (TLS / STARTTLS)
        +-- OAuth: Google and Microsoft (XOAUTH2), Google Drive (relay archive)
        +-- HTTP relay APIs (send-only accounts)
        +-- R2 binding (optional, relay archive)
```

Key constraints:

- Browsers cannot speak IMAP/SMTP, so all mailbox traffic goes through Pages Functions.
- Cloudflare Workers can open **outbound** TCP sockets with `cloudflare:sockets`. They cannot accept inbound TCP connections.
- Port 25 is blocked by Cloudflare and is not used.
- IMAP `IDLE` is not supported across requests. The UI refreshes on navigation, after sending, or on reload.

## 3. Request flows

### List messages

1. `GET /api/messages?accountId=all&folder=inbox`
2. For each IMAP account: connect, authenticate, `SELECT` the folder, `UID SEARCH ALL`, keep the last 30 UIDs, `UID FETCH` headers plus `BODYSTRUCTURE`. `BODYSTRUCTURE` is parsed locally to detect attachments without downloading message bodies.
3. Headers are parsed with `postal-mime`; results from all accounts are merged and sorted.
4. Relay accounts contribute their D1 `messages` rows.

### Read a message

1. `GET /api/messages/:id`
2. The ID encodes the account, folder and UID (`i_<account>.<folder>.<uid>`) or a relay row (`r_<uuid>`).
3. The raw MIME is fetched from IMAP or storage and parsed.
4. Text, HTML and attachment metadata are returned. The message is marked `\Seen` for inbox items.

### Send

1. `POST /api/messages/send`
2. The server builds a complete MIME message.
3. **IMAP account:** authenticate and send through the account's own SMTP.
4. If `auto_saves_sent` is false, the same MIME is appended to the provider's Sent folder (`\Sent`, fallback `Sent`).
5. If `draftId` is present, the original draft is deleted.
6. **Relay account:** store the `.eml` in Drive/R2, send through the selected HTTP relay, record metadata in D1.

### Drafts

- **IMAP:** `APPEND` to the `\Drafts` folder with `\Draft \Seen`; delete with `UID STORE +FLAGS (\Deleted)` + `EXPUNGE`.
- **Relay:** MIME stored on Drive/R2 (`drafts/<id>.eml`), metadata in D1 with `folder='draft'`.
- Autosave runs 5 seconds after the last change and every 30 seconds while changes remain. Closing the composer saves pending changes first.
- On IMAP, autosave appends a new draft and deletes the previous one. The new UID comes from `APPENDUID` when the server supports UIDPLUS, otherwise from the highest UID in the Drafts folder.
- An explicit **Save draft** closes the composer and opens the Drafts folder.

## 4. Project structure

```
functions/                 Cloudflare Pages Functions
  _lib/
    imap/client.ts         IMAP client over cloudflare:sockets
    smtp/client.ts         SMTP client (PLAIN, LOGIN, XOAUTH2)
    mail/                  auth helpers, folder lookup, drafts, loading
    mime.ts                MIME builder
    storage/               Drive and R2 adapters
    relay/                 HTTP relay adapters
    microsoft/oauth.ts     Microsoft OAuth2 / XOAUTH2 token flow
  api/                     HTTP endpoints
shared/                    Types, Zod schemas, provider presets
src/                       React application
db/schema.sql              D1 schema
wrangler.toml              Pages project and D1 binding
```

## 5. Data model

### `accounts`

One row per connected identity.

Important fields:

- `kind`: `imap` or `relay`
- `imap_host`, `imap_port`, `imap_security`, `smtp_host`, `smtp_port`, `smtp_security`
- `username`
- `auth_type`: `password` or `oauth2`
- `secret_enc`: encrypted password or OAuth refresh token
- `access_token_enc`, `access_token_expires_at`
- `oauth_provider`: currently `microsoft`
- `sent_folder`, `auto_saves_sent`
- `signature`: optional per-account signature, used only when `signature_mode` is `per_account`
- `storage_driver`: `provider`, `drive` or `r2`
- `relay_provider`, `relay_api_key_enc`, `relay_api_secret_enc`, `relay_domain`, `relay_region`
- `drive_*` fields for the optional Drive archive

### `messages`

Used for relay accounts only: sent copies and drafts. IMAP messages are read live from the provider and are not mirrored into D1.

Fields include folder, addresses JSON, subject, snippet, body text/HTML, size, storage key, attachment metadata and status.

### `labels` and `message_labels`

`labels` stores the custom label definitions (name, color). `message_labels` stores assignments keyed by the app message id (`i_<account>.<folder>.<uid>` for IMAP, `r_<uuid>` for relay messages). IMAP assignments survive page reloads but refer to IMAP UIDs; if a mailbox changes UIDVALIDITY, reassign labels on affected messages. Deleting a label or an account removes the related assignments.

### `app_settings`

Key/value store for deployment-wide preferences. Currently used for `default_signature` and `signature_mode`.

`signature_mode` is `shared` (default) or `per_account`:

- `shared`: `default_signature` is used for every account and `accounts.signature` is ignored.
- `per_account`: every account uses its own `accounts.signature`; an empty value means no signature.

## 6. Security model

- **Single shared password:** `APP_PASSWORD` protects the whole deployment. The session is an HMAC-SHA256 token in an `HttpOnly`, `SameSite=Lax` cookie, marked `Secure` on HTTPS, valid for 30 days.
- **Origin check:** mutating requests with a foreign `Origin` header are rejected.
- **Credential encryption:** IMAP/SMTP passwords, OAuth refresh tokens and relay API keys are encrypted with AES-256-GCM using `TOKEN_ENC_KEY` (32 raw bytes, base64 encoded).
- **Key rotation:** changing `TOKEN_ENC_KEY` makes all stored credentials unreadable. Users must re-enter passwords and reconnect OAuth accounts.
- **No multi-tenancy:** there is no per-user isolation. This is intended for personal or small trusted deployments. Put Cloudflare Access in front for stronger authentication.
- **Secrets:** `.dev.vars` is gitignored. Production secrets belong in the Pages project settings.

## 7. Authentication per account

| Provider | Method |
|---|---|
| Google accounts | OAuth2 (recommended) or app password (2-Step Verification required) |
| Outlook / Microsoft 365 | OAuth2 + XOAUTH2 (basic auth is no longer supported by Microsoft) |
| Yahoo | App password |
| iCloud | App-specific password |
| Generic IMAP | Account password or app password |
| Relay accounts | Provider HTTP API key (+ secret/domain where required) |

## 8. Relay accounts and storage

Relay accounts are for send-only domains. Supported providers:

`smtp2go`, `resend`, `mailgun`, `brevo`, `sendgrid`, `mailjet`, `postmark`.

- Credentials can be entered per account in the UI and are encrypted.
- Deployment-level `RELAY_*` variables act as a fallback.
- The sender domain must be verified with the provider (SPF/DKIM).
- Conservative attachment limits are enforced per provider: 15 MB for most, 12 MB for Mailjet, 8 MB for Brevo.

Archive storage:

- **Google Drive:** per-user OAuth with `drive.file`; files live in a `MailClient` folder. 15 GB free for personal accounts. Service accounts have no storage quota and cannot be used as a free bucket.
- **Cloudflare R2:** optional binding named `BUCKET`. When the binding is absent, R2 is hidden in the UI.

IMAP accounts never use external storage: attachments, Sent copies and drafts stay on the mail provider.

## 9. Account chips and custom labels

Messages carry `accountId`, `accountName` and `accountEmail`. The unified view shows a deterministic color label per connected address, and the account bar filters by address. This is address-level labeling, not alias-level labeling.

Custom labels are separate and user-defined. Create them from the sidebar, then apply them from the reading pane. Clicking a label opens a label view: the API reads `message_labels`, groups the assigned message ids by account and folder, fetches those IMAP UIDs directly from the provider and merges them with relay messages. The view therefore covers Inbox, Sent and Drafts across the selected accounts, like Gmail, without mirroring the whole mailbox locally. Removed or expunged messages simply disappear from the view.

When a message moves to another folder on the provider, its UID changes and the local label assignment no longer applies. A full local mirror (see the TODO) would make label assignments stable across moves.

## 10. Internationalization

- Default locale: English.
- Italian included.
- Choice persisted in `localStorage` (`mc_locale`).
- UI strings live in `src/i18n.tsx`; add a locale object and a `LOCALES` entry to extend.
- Provider/server error strings are not translated.

## 11. Local development

```bash
npm install
npm run db:local
npm run dev
npm run dev:api
```

- `npm run db:local` applies `db/schema.sql` to the local D1 database.
- `npm run db:migrate:local` applies the additive labels/signatures migration to an existing local database.
- `npm run dev` starts Vite on port 5173.
- `npm run dev:api` starts Pages Functions on port 8788 and proxies static files to Vite.
- Open `http://localhost:8788`.

`.dev.vars`:

```env
APP_PASSWORD=change-me
TOKEN_ENC_KEY=<32-byte base64 key>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_MAIL_CLIENT_ID=
GOOGLE_MAIL_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT=common
RELAY_PROVIDER=smtp2go
RELAY_API_KEY=
```

Generate `TOKEN_ENC_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Checks:

```bash
npm run typecheck
npm run build
npm run lint
```

## 12. Cloudflare deployment overview

> **Complete step-by-step guide:** [CLOUDFLARE.md](CLOUDFLARE.md). It covers dashboard clicks, exact commands, D1 setup, bindings, secrets, OAuth applications, verification and troubleshooting.

### Prerequisites

- Cloudflare account with Workers & Pages enabled
- Node.js 22+
- `npx wrangler login`
- The repository pushed to GitHub (private repositories are supported)

### 12.1 Create the D1 database

```bash
npx wrangler d1 create mail-client
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mail-client"
database_id = "<your-database-id>"
```

### 12.2 Create the Pages project

Dashboard route:

1. Workers & Pages → Create → Pages → Connect to Git.
2. Select the repository.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Root directory: `/`
6. Set `NODE_VERSION=22` if the default is older.

CLI alternative:

```bash
npx wrangler pages project create mail-client
npm run deploy
```

`npm run deploy` builds the frontend and runs `wrangler pages deploy dist`.

### 12.3 Bindings

In the Pages project settings → Bindings:

- **D1**: variable name `DB`, database `mail-client`.
- **R2 (optional)**: variable name `BUCKET`, choose or create a bucket.

Keep the binding names exactly `DB` and `BUCKET`.

### 12.4 Secrets and variables

Add these in Pages → Settings → Variables and Secrets. Use encrypted secrets for credentials.

Required:

| Name | Type | Notes |
|---|---|---|
| `APP_PASSWORD` | Secret | Login password for the whole app |
| `TOKEN_ENC_KEY` | Secret | 32-byte base64 key; do not change after entering credentials |

Optional:

| Name | Type | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Secret | Google Drive archive for relay accounts |
| `GOOGLE_CLIENT_SECRET` | Secret | Google OAuth client secret |
| `GOOGLE_MAIL_CLIENT_ID` | Secret | Google OAuth client for IMAP/SMTP |
| `GOOGLE_MAIL_CLIENT_SECRET` | Secret | Google OAuth secret for IMAP/SMTP |
| `MICROSOFT_CLIENT_ID` | Secret | Microsoft OAuth application ID |
| `MICROSOFT_CLIENT_SECRET` | Secret | Microsoft client secret |
| `MICROSOFT_TENANT` | Variable | `common` or a tenant ID |
| `RELAY_PROVIDER` | Variable | Deployment-wide relay fallback |
| `RELAY_API_KEY` | Secret | Fallback relay key |
| `RELAY_API_SECRET` | Secret | Mailjet fallback secret |
| `MAILGUN_DOMAIN` | Variable | Mailgun fallback domain |
| `MAILGUN_REGION` | Variable | `us` or `eu` |

Relay credentials entered per account in the UI take precedence over these values.

### 12.5 Apply the schema

```bash
npm run db:remote
```

If you already created the tables before labels and signatures were added, apply the additive migration:

```bash
npm run db:migrate:remote
```

If you already created the tables before relay support, apply the additive migration:

```sql
ALTER TABLE accounts ADD COLUMN relay_api_key_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_api_secret_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_domain TEXT;
ALTER TABLE accounts ADD COLUMN relay_region TEXT;
```

### 12.6 Workers Paid

IMAP and SMTP TLS handshakes plus authentication frequently exceed the free Workers CPU budget (10 ms). Use the Workers Paid plan (starting at $5/month) for a usable deployment.

### 12.7 Google Drive OAuth (optional)

Only needed for relay accounts that archive on Drive.

1. Google Cloud Console → enable the Google Drive API.
2. OAuth consent screen → External.
3. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/drive.file`.
4. Create an OAuth client ID of type Web application.
5. Authorized redirect URIs:
   - `https://<your-domain>/api/drive/oauth/callback`
   - `http://localhost:8788/api/drive/oauth/callback` for local development.
6. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
7. Set the consent screen to **In production**. In Testing mode, refresh tokens expire after 7 days. `drive.file` is non-sensitive, so no CASA assessment is required.

### 12.8 Google OAuth for IMAP/SMTP (optional)

Google accounts can authenticate over IMAP/SMTP with OAuth2, the same model Thunderbird uses. It requires the restricted scope `https://mail.google.com/`.

1. Google Cloud Console → create or select a project.
2. OAuth consent screen → External (or Internal for Workspace-only use).
3. Scopes: `openid`, `email`, `https://mail.google.com/`.
4. Create an OAuth client ID of type **Web application**. Prefer a dedicated client, separate from the Drive client, so the Drive-only setup remains non-sensitive.
5. Authorized redirect URIs:
   - `https://<your-domain>/api/google/oauth/callback`
   - `http://localhost:8788/api/google/oauth/callback`.
6. Set `GOOGLE_MAIL_CLIENT_ID` and `GOOGLE_MAIL_CLIENT_SECRET`.
7. Verification: `https://mail.google.com/` is a restricted scope. A public app in production requires Google verification (CASA). For personal use, keep the consent screen in **Testing** and add the Google accounts as test users: OAuth works, but refresh tokens expire after 7 days. Internal Workspace apps avoid verification but are limited to that organization.

If Google OAuth is not configured, Google accounts can still use an app password with 2-Step Verification.

### 12.9 Microsoft OAuth (optional)

Required for Outlook / Microsoft 365, which no longer accept basic authentication for IMAP/SMTP.

1. Microsoft Entra ID → App registrations → New registration.
2. Supported account types: personal and organizational accounts as needed.
3. Redirect URI (Web):
   - `https://<your-domain>/api/microsoft/oauth/callback`
   - `http://localhost:8788/api/microsoft/oauth/callback`.
4. Certificates & secrets → create a client secret.
5. API permissions (delegated):
   - Office 365 Exchange Online: `IMAP.AccessAsUser.All`, `SMTP.Send`
   - OpenID scopes: `offline_access`, `openid`, `email`, `profile`
6. Grant admin consent if your tenant requires it.
7. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (`common` for personal + work).

### 12.10 Custom domain

Pages → Custom domains → add the domain and follow the DNS instructions. After changing the domain, update the OAuth redirect URIs.

### 12.11 Post-deploy checklist

- `GET /api/health` returns `ok: true`.
- Sign in with `APP_PASSWORD`.
- Add an IMAP account and use **Test connection** in Settings.
- Send a message and verify it in the provider's Sent folder.
- Save a draft and reopen it.
- Add a second account and verify labels and the unified inbox.
- For relay accounts, verify the relay key, domain verification and archive storage.

## 13. Environment reference

| Name | Required | Purpose |
|---|---|---|
| `APP_PASSWORD` | Yes | App login |
| `TOKEN_ENC_KEY` | Yes | AES-GCM key for stored credentials |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Drive archive |
| `GOOGLE_MAIL_CLIENT_ID` / `GOOGLE_MAIL_CLIENT_SECRET` | No | Google OAuth for IMAP/SMTP |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | No | Outlook OAuth |
| `MICROSOFT_TENANT` | No | Defaults to `common` |
| `RELAY_PROVIDER` | No | Default relay fallback |
| `RELAY_API_KEY` | No | Default relay key fallback |
| `RELAY_API_SECRET` | No | Mailjet fallback secret |
| `MAILGUN_DOMAIN` / `MAILGUN_REGION` | No | Mailgun fallback |
| `DB` (D1 binding) | Yes | Metadata |
| `BUCKET` (R2 binding) | No | R2 archive |

## 14. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Google `AUTHENTICATIONFAILED` | Use OAuth or an app password with 2FA enabled, not the account password |
| Google OAuth stops working after ~7 days | Consent screen still in Testing; use an Internal app or complete verification, or fall back to an app password |
| Google “access blocked” | Redirect URI mismatch, missing test user, or restricted-scope verification required |
| Outlook login fails | Missing OAuth permissions, redirect URI mismatch, or admin consent |
| Connection timeout | Wrong host/port/security: 993 TLS, 465 TLS, 587 STARTTLS, 143 STARTTLS |
| Sent copy not saved | Provider lacks `\Sent`/`APPEND`; set the folder manually or adjust `auto_saves_sent` |
| Duplicate sent mail | `auto_saves_sent` is false but the provider already saves sent mail |
| Drafts not saved | No `\Drafts` folder or no `APPEND` permission |
| Drive 403 | OAuth scopes, testing-mode token expiry, or Drive not connected |
| R2 option hidden | Missing `BUCKET` binding |
| Attachment rejected | Provider-specific message size limit |
| `CPU time limit exceeded` | Upgrade to Workers Paid |
| D1 errors after deploy | Placeholder `database_id` or schema not applied |

## 15. Known limitations

- No IMAP IDLE/push and no background sync.
- Last 30 messages per folder; client-side search over loaded messages.
- No IMAP server-side search UI beyond the latest page.
- HTML bodies are stripped to text; remote images and tracking pixels are not loaded.
- Attachments are fetched by re-reading the full message on each download.
- No alias-based send-as; the sender is the account address.
- Autosave requires the provider to accept `APPEND` in the Drafts folder; without `APPENDUID`, the new UID is resolved with a search, which can be ambiguous with concurrent clients.
- Account deletion does not delete provider mail or relay storage objects.
- No per-user isolation, rate limiting, or audit log.
- Generic API errors include a stable `code`; the UI translates it. Provider details (for example IMAP or relay responses) are shown verbatim.
- Attachment indicators in lists come from `BODYSTRUCTURE`; the body is still downloaded only when a message is opened.

## 16. License

MIT — see [LICENSE](../LICENSE).
