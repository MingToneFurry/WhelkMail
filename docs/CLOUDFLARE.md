<a id="deploying-whelkmail-on-cloudflare"></a>

# 在 Cloudflare 上部署 WhelkMail

本指南介绍如何使用 Cloudflare 运行 WhelkMail。你只需要一个 Cloudflare 账户，无须准备 VPS、邮件服务器或额外的后端服务。

> **新部署默认使用 Workers。** 已使用 Pages 的用户可以继续按照本指南部署。Workers 的步骤见[部署指南](DEPLOYMENT.md)。两个版本共用后端代码，都使用 D1、R2 和 `cloudflare:sockets`。

> 网页和后端需要一起部署。请选择**带 Functions 的 Pages 项目**或**托管静态资源的 Worker**。Pages 从 `functions/` 加载 API，通过 `cloudflare:sockets` 连接 IMAP/SMTP；Workers 的入口是 `server/entries/workers.ts`。只上传 `dist` 会导致所有 API 请求失败。

<a id="what-you-will-create"></a>

## 需要创建的资源

| Cloudflare 资源 | 用途 |
|---|---|
| Pages 项目 | 托管网页和 Pages Functions（`functions/`） |
| D1 数据库 | 存储账户、设置、IMAP 同步进度，以及中继账户的归档和草稿信息 |
| 密钥（Secrets） | 存储网站登录密码、加密密钥以及可选的 OAuth 和中继凭据 |
| R2 存储桶（可选） | 存储中继账户的已发送邮件、草稿，以及选择归档的 IMAP 正文和附件 |
| 自定义域名（可选） | 为网站配置 HTTPS 访问地址 |

<a id="before-you-start"></a>

## 准备工作

- 一个 Cloudflare 账户。
- 包含本项目代码的 GitHub 仓库。
- Node.js 24 或更高版本及 npm。Pages 和 Workers 的构建过程也支持 Node.js 22。
- 运行以下命令登录 Wrangler。
  ```bash
  npx wrangler login
  ```
- 上游建议使用 Workers 付费套餐。IMAP/SMTP 的 TLS 握手和身份验证经常超过免费套餐每次调用的 10 毫秒 CPU 时间上限。

<a id="1-deploy-from-github-recommended"></a>

## 1. 通过 GitHub 部署（推荐）

<a id="11-create-the-d1-database"></a>

### 1.1 创建 D1 数据库

```bash
npx wrangler d1 create mail-client
```

命令会输出 `database_id`。配置方法取决于部署方式。

- **通过 GitHub 部署**：在 Pages 控制台设置 `DB` 绑定。仓库中的 `wrangler.jsonc` 只提供本地开发用的绑定。
- **通过 CLI 或在本地运行**：将 `wrangler.jsonc` 里的占位符替换为实际 ID。

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "mail-client",
    "database_id": "<paste-the-database-id-here>"
  }
]
```

发布自己的 fork 时，请将真实的数据库 ID 留在本地。Pages 不支持自定义配置文件路径，请移除本地旧的 `wrangler.toml`。公开仓库中的全零 UUID 可用于本地开发，CLI 操作远程数据库时则需要真实的 D1 ID。

> D1 沿用旧名称 `mail-client`，以便更名为 WhelkMail 后仍能使用原部署和数据。Pages 项目名为 `whelkmail`。

也可以在 Cloudflare 控制台进入 **Storage & Databases → D1 SQL Database → Create** 创建数据库。

<a id="12-create-the-pages-project-from-github"></a>

### 1.2 从 GitHub 创建 Pages 项目

1. 在 Cloudflare 控制台打开 **Workers & Pages**。
2. 选择 **Create → Pages → Connect to Git**。
3. 选择仓库和分支。
4. 项目名称填写 `whelkmail`。
5. 填写构建设置。

| 设置 | 值 |
|---|---|
| 框架预设（Framework preset） | None 或 Vite |
| 构建命令（Build command） | `npm run build` |
| 构建输出目录（Build output directory） | `dist` |
| 根目录（Root directory） | `/` |

如默认 Node.js 版本较旧，请在 Pages 项目设置中添加环境变量 `NODE_VERSION=22`。Pages 会自动识别 `functions/`。

<a id="13-add-bindings"></a>

### 1.3 添加资源绑定

在 Pages 项目中打开 **Settings → Bindings**。

| 绑定名称 | 类型 | 目标 | 是否必需 |
|---|---|---|---|
| `DB` | D1 数据库 | `mail-client` | 必需 |
| `BUCKET` | R2 存储桶 | 你创建的存储桶 | 可选 |

请保留绑定名称及大小写，应用通过 `env.DB` 和 `env.BUCKET` 访问资源。

<a id="14-add-secrets-and-variables"></a>

### 1.4 添加密钥和环境变量

在 Pages 项目中打开 **Settings → Variables and Secrets**，为生产环境（**Production**）添加以下两项。如果使用预览部署，也请为 **Preview** 添加相应配置。

| 名称 | 类型 | 值 |
|---|---|---|
| `APP_PASSWORD` | 密钥 | 整个 WhelkMail 网站的登录密码 |
| `TOKEN_ENC_KEY` | 密钥 | 将 32 个随机字节编码为 Base64 后得到的字符串 |

生成加密密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

也可以使用 CLI 设置这两个密钥：

```bash
npx wrangler pages secret put APP_PASSWORD --project-name whelkmail
npx wrangler pages secret put TOKEN_ENC_KEY --project-name whelkmail
```

其他配置按需添加。

| 名称 | 类型 | 用途 |
|---|---|---|
| `GOOGLE_MAIL_CLIENT_ID` | 密钥 | Gmail IMAP/SMTP 的 Google OAuth 客户端 ID |
| `GOOGLE_MAIL_CLIENT_SECRET` | 密钥 | Gmail OAuth 客户端密钥 |
| `GOOGLE_CLIENT_ID` | 密钥 | Google 云端硬盘归档客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 密钥 | Google 云端硬盘客户端密钥 |
| `MICROSOFT_CLIENT_ID` | 密钥 | Microsoft OAuth 客户端 ID |
| `MICROSOFT_CLIENT_SECRET` | 密钥 | Microsoft OAuth 客户端密钥 |
| `MICROSOFT_TENANT` | 变量 | `common` 或租户 ID |
| `RELAY_PROVIDER` | 变量 | 部署级的默认中继服务商 |
| `RELAY_API_KEY` | 密钥 | 部署级的默认中继 API 密钥 |
| `RELAY_API_SECRET` | 密钥 | Mailjet 默认 API Secret |
| `MAILGUN_DOMAIN` | 变量 | Mailgun 默认发信域名 |
| `MAILGUN_REGION` | 变量 | `us` 或 `eu` |
| `VAPID_PUBLIC_KEY` | 变量或密钥 | 网页推送的 VAPID 公钥 |
| `VAPID_PRIVATE_KEY` | 密钥 | 网页推送的 VAPID 私钥 |
| `VAPID_SUBJECT` | 变量 | VAPID 联系人，例如 `mailto:you@example.com` |
| `CRON_SECRET` | 密钥 | 定时任务 Worker 与 Pages 后端共享的密钥 |

在界面中为单个账户输入的中继凭据优先于部署默认值。更改 `TOKEN_ENC_KEY` 后，之前保存的 IMAP/SMTP 密码、OAuth 刷新令牌和中继 API 密钥会失效。轮换前请安排好重新录入和授权。

<a id="15-apply-the-database-schema"></a>

### 1.5 初始化数据库结构

```bash
npm run db:init:remote
```

该命令会执行以下 SQL 文件：

```bash
wrangler d1 execute mail-client --remote --file=./db/schema.sql
```

列出数据表，确认输出中包含 `accounts` 和 `messages`：

```bash
npx wrangler d1 execute mail-client --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table';"
```

如果数据库早于标签和签名功能，请运行增量迁移：

```bash
npm run db:migrate:remote
```

`db/migrations/001_labels_signatures.sql` 至 `db/migrations/016_sync_lock.sql` 等迁移陆续加入了标签、过滤器、联系人、IMAP 同步与归档、推送、按过滤器转发、服务商邮件删除记录、每账户自动同步设置、安全表（会话、登录频率限制、一次性 OAuth 状态）、草稿和垃圾邮件文件夹缓存、短期正文缓存，以及跨实例同步锁。

脚本会将已执行的迁移写入 `schema_migrations`。再次运行会从缺失的迁移继续。如需指定起点：

```bash
node scripts/migrate.mjs remote --from=013
```

迁移 `012` 会使现有会话失效，用户需要重新登录。双重验证默认关闭，可在「设置 → 安全」启用。

<a id="16-web-push-notifications-optional"></a>

### 1.6 网页推送通知（可选）

生成 VAPID 密钥对：

```bash
npm run vapid
```

为 Pages 项目添加以下密钥：

```bash
npx wrangler pages secret put VAPID_PUBLIC_KEY --project-name whelkmail
npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name whelkmail
npx wrangler pages secret put CRON_SECRET --project-name whelkmail
```

`VAPID_SUBJECT` 可以是普通变量，例如 `mailto:you@example.com`。

定时任务 Worker 的配置因部署而异，Git 默认忽略它。请复制模板，设置 Pages 地址并部署：

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
# 在 worker/wrangler.toml 中将 APP_URL 设为 https://<your-project>.pages.dev
npx wrangler secret put CRON_SECRET -c worker/wrangler.toml
npm run cron:deploy
```

如果配置文件尚不存在，`npm run cron:deploy` 会从模板生成一份。`APP_URL` 为空或仍为占位符时，脚本会停止并提示修正。

Worker 每分钟唤醒一次，调用 Pages 的 `POST /api/cron/notifications`。每次都会检查通知、自动转发和可选的服务商清理任务。每个账户的后台同步有独立周期，在「设置 → 账户 → 检查新邮件」中选择 1、2、5、10、15 或 30 分钟，默认 5 分钟。在「设置 → 推送通知」中启用通知，在账户设置中启用后台同步，在账户和过滤器设置中分别配置清理和转发。

如果升级前已部署该 Worker，请重新运行 `npm run cron:deploy`。触发器已从 `*/5 * * * *` 改为 `* * * * *`；保留旧配置会让所有账户最快每五分钟才能检查一次。

Workers 免费套餐每次调用限用 10 毫秒 CPU 时间，每日请求配额为 100,000 次。没有到期任务时，每分钟一次的调度每天约唤醒 1,440 次，另外还会请求 Pages 后端。1 或 2 分钟的同步周期会频繁建立 TLS 连接，通常需要付费套餐。免费部署可改用 `crons = ["*/5 * * * *"]`，代价是无法实现短于五分钟的同步周期。

如数据库早于中继功能，请使用迁移脚本：

```bash
npm run db:migrate:remote
```

脚本会记录进度，重复执行只补齐缺失的迁移。较老的数据库还需要后续加入的中继字段，以上命令会一并更新。

| 迁移 | 新增内容 |
|---|---|
| `020_relay_sent_copy` | `accounts.sent_copy_account_id`，指定保存已发送副本的位置（Drive、R2 或 IMAP 邮箱） |
| `022_reply_account` | `accounts.reply_account_id`，指定收到转发邮件的邮箱要使用哪个账户回复 |
| `026_relay_any_address` | `accounts.relay_any_address`，允许以本域名的任意地址发信 |

完全没有中继支持的旧版数据库最早新增了以下四列：

```sql
ALTER TABLE accounts ADD COLUMN relay_api_key_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_api_secret_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_domain TEXT;
ALTER TABLE accounts ADD COLUMN relay_region TEXT;
```

<a id="16-deploy"></a>

### 1.6 部署

- **Git 集成**：推送到关联分支，Cloudflare 会自动构建和部署。
- **手动重试**：在 Pages 项目中进入 **Deployments**，选择 **Retry deployment**。

初次部署的地址通常是 `https://whelkmail.pages.dev`。如果项目使用其他名称，请用实际项目名替换 `whelkmail`。

<a id="17-first-login-and-account-setup"></a>

### 1.7 首次登录并添加账户

1. 打开部署地址。
2. 输入 `APP_PASSWORD` 登录。
3. 在侧栏或设置中选择**添加账户**。
4. 选择 **IMAP/SMTP 邮箱**或**仅发信（中继）**。
5. 添加 IMAP 邮箱时，选择服务商预设或手动输入 IMAP/SMTP 主机、端口和安全协议。支持 OAuth 的服务商可以使用 OAuth，也可以按服务商要求填写密码或应用专用密码。在设置中运行**测试连接**。
6. 添加仅发信域名时，选择中继服务商，粘贴其 API 密钥。选择已发送副本和草稿的保存位置：**Google 云端硬盘**、**R2**（需要 `BUCKET` 绑定）或**其他账户的邮箱**。邮箱方案会将邮件追加到指定 IMAP 账户的已发送或草稿文件夹，需要一个已连接的 IMAP 账户。没有符合条件的账户时，该选项不可用；目标账户断开时，草稿可能保存失败并返回 `sent_copy_target_not_connected`。一次只能选择一个保存位置，切换回 Drive/R2 会清除邮箱目标。
7. 发送一封测试邮件。
8. 保存一封草稿，在**草稿箱**重新打开并删除。如保存位置是 IMAP 邮箱，还应在服务商的草稿文件夹检查副本。
9. 添加第二个账户，查看地址标签及统一收件箱。

<a id="18-custom-domain"></a>

### 1.8 自定义域名

1. 在 Pages 项目中进入 **Custom domains → Set up a custom domain**。
2. 输入主机名，按提示配置 DNS。
3. 等待证书生效。
4. 如使用 OAuth，请同步更新回调 URI 中的主机名。

<a id="2-deploy-from-the-cli-instead-of-github"></a>

## 2. 通过 CLI 部署

```bash
npx wrangler pages project create whelkmail
npm run build
npx wrangler pages deploy dist --project-name whelkmail
```

也可以运行：

```bash
npm run deploy:pages
```

`npm run deploy:pages` 会先执行 `npm run build`，再执行 `wrangler pages deploy dist`。

CLI 部署从 `wrangler.jsonc` 读取资源绑定（在本地替换 D1 ID 占位符），通过 Wrangler 的密钥命令设置密钥。GitHub 部署则在 Pages 控制台配置 D1 绑定和密钥；公开的 `wrangler.jsonc` 文件可以继续保留占位符。

<a id="3-oauth-setup"></a>

## 3. 配置 OAuth

通用 IMAP 邮箱和使用应用专用密码的账户可以按需选择 OAuth。Microsoft 365 和 Outlook 已停用 IMAP/SMTP 的基本身份验证，因此需要 OAuth。

<a id="31-google-oauth-for-imapsmtp"></a>

### 3.1 为 Gmail IMAP/SMTP 配置 Google OAuth

为 Gmail 单独创建 OAuth 客户端；云端硬盘继续使用范围较小的独立客户端。

1. 在 Google Cloud 控制台创建或选择项目。
2. 将 OAuth 同意屏幕的受众设为**外部（External）**。仅在自己的 Workspace 组织中使用时，也可选择**内部（Internal）**。
3. 添加权限范围 `openid`、`email`、`https://mail.google.com/`。
4. 创建类型为 **Web 应用（Web application）**的 OAuth 客户端 ID。
5. 添加已获授权的重定向 URI：
   - `https://<your-domain>/api/google/oauth/callback`
   - 本地开发可用 `http://localhost:8788/api/google/oauth/callback`
6. 设置 `GOOGLE_MAIL_CLIENT_ID` 和 `GOOGLE_MAIL_CLIENT_SECRET`。

`https://mail.google.com/` 属于 Google 的**受限权限范围**。

- 面向公众的生产应用需要通过 Google 验证，并按要求完成 CASA 安全评估。
- 个人部署可保持**测试（Testing）**状态，并把自己的 Google 账户加入测试用户。该模式下刷新令牌 7 天后过期。
- Google Workspace 的**内部（Internal）**应用只对本组织用户开放，无须走公众应用的验证流程。
- 如果没有配置 OAuth，可在开启两步验证后使用应用专用密码。

<a id="32-google-drive-oauth-relay-and-imap-archive-optional"></a>

### 3.2 Google 云端硬盘 OAuth（中继与 IMAP 归档，可选）

1. 在 Google Cloud 控制台启用 Google Drive API。
2. 将 OAuth 同意屏幕的受众设为**外部（External）**。
3. 添加 `openid`、`email`、`https://www.googleapis.com/auth/drive.file` 三项权限范围。
4. 创建 **Web 应用（Web application）**类型的 OAuth 客户端 ID。
5. 添加重定向 URI：
   - `https://<your-domain>/api/drive/oauth/callback`
   - `http://localhost:8788/api/drive/oauth/callback`
6. 设置 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。
7. 将应用发布状态设为**正式发布（In production）**，避免测试模式下刷新令牌 7 天后过期。`drive.file` 属于非敏感权限范围，无需 CASA 评估。

在设置中启用**归档正文和附件**的 IMAP 账户也会使用这组凭据。Gmail 收发信使用独立的 `GOOGLE_MAIL_CLIENT_ID` 和 `GOOGLE_MAIL_CLIENT_SECRET`。

<a id="33-microsoft-oauth-outlook--microsoft-365"></a>

### 3.3 Microsoft OAuth（Outlook / Microsoft 365）

1. 进入 **Microsoft Entra ID → App registrations → New registration**。
2. 按实际用户选择支持的账户类型：个人账户、组织账户或两者均支持。
3. 添加 Web 平台的重定向 URI：
   - `https://<your-domain>/api/microsoft/oauth/callback`
   - `http://localhost:8788/api/microsoft/oauth/callback`
4. 进入 **Certificates & secrets**，创建客户端密钥。
5. 添加委托 API 权限：
   - Office 365 Exchange Online：`IMAP.AccessAsUser.All`、`SMTP.Send`
   - OpenID：`offline_access`、`openid`、`email`、`profile`
6. 如租户要求，请授予管理员同意。
7. 设置 `MICROSOFT_CLIENT_ID` 和 `MICROSOFT_CLIENT_SECRET`。可选变量 `MICROSOFT_TENANT` 填 `common` 时同时支持个人及工作账户。

<a id="34-relay-provider-setup"></a>

### 3.4 配置中继服务商

为仅发信账户配置中继：

1. 在服务商处注册账户。
2. 在服务商控制台验证发信域名，配置 SPF 和 DKIM。
3. 复制服务商提供的 API 密钥。
4. 在 WhelkMail 的添加账户表单或设置中填写密钥。
5. 选择**Google 云端硬盘**、**R2** 或**其他账户的邮箱**作为已发送副本和草稿的保存位置。选择 IMAP 邮箱时，两类邮件会分别追加到已连接账户的已发送和草稿文件夹。

> 中继账户需要一个可用的保存目标。如果目标本身不可用（例如 Drive 未连接、缺少 `BUCKET` 绑定，或所选 IMAP 邮箱断开），发信前的检查可能会中止投递并返回配置或存储错误。使用 IMAP 目标时，中继先接受邮件，随后才写入已发送文件夹；若此时写入失败，请先确认投递状态，再决定是否重发。

支持的服务包括 SMTP2GO、Resend、Mailgun、Brevo、SendGrid、Mailjet、Postmark 和 Cloudflare Email Service。

**Cloudflare Email Service**（[REST API 文档](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)）

> **实验性功能。** 上游维护者尚未使用真实 Cloudflare 账户验证该适配器。以下配置依据 REST API 文档，实际投递、抑制列表处理和限流行为仍需验证。建议用测试邮件验证后再处理重要往来。

- **API 密钥**：使用拥有 **Email Sending: Edit** 权限的 API 令牌。账户级 API 令牌仅关联一个账户，配置最简单。
- **账户 ID**：可留空。保存时，若令牌只能访问一个账户，WhelkMail 会查出其 ID。可访问多个账户的用户令牌需要填写 ID，位置在控制台账户首页或 `dash.cloudflare.com/` 后的 URL 路径。无论哪种方式，保存时都会检查令牌对账户的访问权限。用户令牌可访问超过 500 个账户时，无法完成检查，应改用账户级令牌。若令牌无法访问任何账户，会返回 `relay_account_unavailable`；请在发信账户中创建有 **Email Sending: Edit** 权限的账户级令牌。
- **发信域名**：在同一账户下的 **Email Service → Email Sending** 中启用域名。每个子域名都需要单独启用，否则发信时会出现包含域名的错误（Cloudflare 错误码 `10203`）。列出某个区域的发信域名还需要读取区域的权限，WhelkMail 在保存账户时无法完成这项检查。
- **抑制列表**：默认情况下，只要有一个收件人属于 Cloudflare 的抑制列表，整封邮件就会被拒绝（`10205`）。在发信域名下打开 **Drop suppressed recipients** 后，其他收件人仍可收到邮件，WhelkMail 会列出未投递的地址。
- **自定义 SMTP**：Workers 会阻止连接 Cloudflare 自有 IP 段的 TCP 套接字，因此该选项无法连接 `smtp.mx.cloudflare.net`。
- **限制**：调用 API 前，WhelkMail 会检查每封邮件的收件人数（含抄送和密送，最多 **50 人**）和附件总量（最多 **15 MiB**），以符合 Cloudflare 对编码后邮件 **25 MiB** 的限制。超限会返回 `too_many_recipients` 或 `attachment_too_large`。

<a id="4-optional-r2-archive"></a>

## 4. 使用 R2 归档（可选）

仅发信中继账户可使用 R2；IMAP 账户也可以启用 R2 归档正文和附件。默认情况下，IMAP 邮件保存在邮箱服务商处。

1. 进入 **R2 Object Storage → Create bucket** 创建存储桶。
2. 在 Pages 项目下进入 **Settings → Bindings**，添加名为 `BUCKET` 的 R2 存储桶绑定。
3. 重新部署。

未配置绑定时，界面会隐藏 R2 选项。

<a id="5-verification-checklist"></a>

## 5. 部署验证

- `GET /api/health` 返回 `ok: true`。
- 使用 `APP_PASSWORD` 成功登录。启用双重验证时还应输入 TOTP 验证码。
- 可选验证：在「设置 → 安全」启用双重验证，再使用恢复码登录。
- `/` 和 `/api/health` 的响应中包含安全响应头。
- 对 IMAP 账户运行**测试连接**并确认成功。
- 发信后，服务商的已发送文件夹存在副本。关闭 `auto_saves_sent` 时，由应用将副本追加到该文件夹。
- 草稿可保存、重新打开及删除。
- 添加两个账户后，可以看到彩色标签和统一收件箱。
- 可选验证：中继账户以及启用了正文归档的 IMAP 账户能使用 Drive/R2 归档。
- 可选验证：OAuth 令牌刷新后可以重新连接。

<a id="6-operations"></a>

## 6. 运行维护

<a id="logs"></a>

### 查看日志

在 Pages 项目中进入 **Deployments**，选择一次部署并打开 **Logs**，也可使用命令：

```bash
npx wrangler pages deployment tail --project-name whelkmail
```

<a id="rollback"></a>

### 回滚

在 Pages 项目中进入 **Deployments**，选择之前的部署并点击 **Rollback**。

<a id="d1-backup"></a>

### 备份 D1

```bash
npx wrangler d1 export mail-client --remote --output backup.sql
```

<a id="schema-updates"></a>

### 更新数据库结构

修改 `db/schema.sql` 后，重新运行 `npm run db:remote`。`CREATE TABLE IF NOT EXISTS` 对已存在的表不做改动；增加字段等变更应通过 `ALTER TABLE` 迁移。

<a id="secret-rotation"></a>

### 轮换密钥

- 更新 `APP_PASSWORD` 后，现有会话将在原定的 7 天有效期内继续可用。要立即注销所有会话，可清空 `sessions` 表中的会话记录。更换 `TOKEN_ENC_KEY` 也会注销会话，但还会使已保存的凭据失效。
- 更新 `TOKEN_ENC_KEY` 后，已加密的凭据、会话和进行中的 OAuth 授权都会失效。用户需要重新输入密码并重新授权 OAuth 账户。

<a id="7-troubleshooting"></a>

## 7. 故障排查

| 现象 | 常见原因或处理方法 |
|---|---|
| 提示 `database_id` 为占位符 | 通过本地 CLI 部署时替换 `wrangler.jsonc` 中的占位符；通过 GitHub 部署时在 Pages 控制台设置 `DB` 绑定 |
| `D1_ERROR: no such table: accounts` | 运行 `npm run db:init:remote`，初始化结构并记录基线 |
| `D1_ERROR: no such table: labels` 或缺少 `message_labels`、`app_settings`、`filters`、`contacts`、`imap_sync`、`imap_messages`、`push_subscriptions`、`push_prefs`、`forward_log`、`deletion_log`、`sessions`、`login_attempts`、`oauth_states`、`imap_body_cache`、`imap_sync_locks`、`schema_migrations` | 运行 `npm run db:migrate:remote`，已记录的迁移会被跳过 |
| `D1_ERROR: no such column: archive_imap_bodies` 或缺少 `archive_key`、`imap_archive_driver`、`auto_sync`、`delete_after_archive`、`forward_to_json`、`drafts_folder`、`spam_folder` | 运行 `npm run db:migrate:remote`，也可按顺序补齐缺失的 `006` 至 `016` 迁移 |
| 登录后反复返回 401 | 检查 `APP_PASSWORD`、浏览器对 Cookie 的限制、HTTPS 以及 `sessions` 表。缺表时运行 `node scripts/migrate.mjs remote --from=012` |
| 所有 API 调用均返回 500 | 检查 `DB` 绑定、必需密钥和安全相关数据表 |
| 中继服务返回 503 | 账户未配置中继服务商，部署也没有默认配置 |
| Google OAuth 返回 503 | 检查 `GOOGLE_MAIL_CLIENT_ID` 和 `GOOGLE_MAIL_CLIENT_SECRET` |
| Microsoft OAuth 返回 503 | 检查 `MICROSOFT_CLIENT_ID` 和 `MICROSOFT_CLIENT_SECRET` |
| OAuth 重定向报错 | 授权重定向 URI 必须与应用配置完全匹配 |
| Google OAuth 约 7 天后失效 | 同意屏幕处于测试状态。可按账户类型改用 Internal、完成生产应用验证，或使用应用专用密码 |
| 找不到 R2 选项 | 配置 `BUCKET` 绑定 |
| `CPU time limit exceeded` | 升级至 Workers 付费套餐 |
| IMAP 连接超时 | 核对主机、端口和加密方式。IMAP 通常使用 993/TLS 或 143/STARTTLS；SMTP 通常使用 465/TLS 或 587/STARTTLS |
| 草稿保存失败 | 服务商没有 `\Drafts` 文件夹，或未允许 `APPEND` |
| 已发送副本重复 | 服务商已自行保存邮件，账户却关闭了 `auto_saves_sent` |
| 中继账户发信返回 `storage_failed` | 检查已发送和草稿的保存位置，连接 Google 云端硬盘、绑定 `BUCKET`，或选择可用的 IMAP 邮箱。若中继已接受邮件而后续归档报错，应先核实投递状态 |
| 发信返回 `too_many_recipients` | 收件人数量超过中继单封上限（含抄送、密送）。Cloudflare Email Service 上限为 50 人 |
| 自定义 SMTP 连接 `smtp.gmail.com`（465/587）或 `smtp.mail.yahoo.com:465` 时出现 `Network connection lost.` | 这些主机可能在身份验证前断开来自 Workers 的连接。可改用接受该连接的主机及应用专用密码，或使用 HTTP 中继 |
| 自定义域名出现 1014/522 | 检查 DNS 记录以及源站是否就绪 |

<a id="8-costs-and-limits"></a>

## 8. 费用与限制

- Pages 和 Workers 都有免费额度。IMAP/SMTP 的 CPU 开销较高，上游建议使用 Workers 付费套餐，起价为每月 5 美元。
- D1 免费套餐提供 5 GB 存储空间，读写操作有每日额度。
- R2 免费套餐提供 10 GB 存储空间，免出站流量费。
- Google 云端硬盘的 15 GB 免费空间与同一 Google 账户的其他服务共用。
- 客户端使用定期同步，尚不支持 IMAP IDLE 实时推送。切换页面、发信或重新载入时也会更新界面。
- 邮件列表分批加载最近的邮件；搜索范围受已同步的数据和正文索引进度影响。
