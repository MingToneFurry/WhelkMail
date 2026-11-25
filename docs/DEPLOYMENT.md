<a id="deployment-targets"></a>
# 部署方式

WhelkMail 可部署到 Cloudflare Workers、Cloudflare Pages 或自有服务器。三种方式共用前端、API 处理程序、安全中间件和邮件收发逻辑。入口文件、存储和网络连接方式见下表。

| | Cloudflare Workers（默认） | Cloudflare Pages | Docker 自托管 |
| --- | --- | --- | --- |
| 入口 | `server/entries/workers.ts` | `functions/api/**` | `server/entries/node.ts` |
| 数据库 | D1（`DB`） | D1（`DB`） | `/data` 下的 SQLite（`node:sqlite`） |
| 对象存储 | R2（`BUCKET`）、Google 云端硬盘 | R2、Google 云端硬盘 | S3/MinIO（`S3_*`）、Google 云端硬盘 |
| IMAP/SMTP 连接 | `cloudflare:sockets` | `cloudflare:sockets` | `node:net` / `node:tls` |
| 后台定时任务 | Worker 触发器 | 单独部署 `worker/` 中的定时任务 | 内置调度器 |
| 静态文件 | Workers Assets | Pages | Node 静态文件服务 |

三种部署方式均使用 `npm run build` 构建前端。

<a id="common-secrets"></a>
## 通用密钥与配置

| 名称 | 是否必填 | 用途 |
| --- | --- | --- |
| `APP_PASSWORD` | 是 | 登录 WhelkMail 的密码 |
| `TOKEN_ENC_KEY` | 是 | 用 Base64 编码的 32 字节随机密钥 |
| `CRON_SECRET` | 仅 Pages 必填 | 验证来自独立 `worker/` 定时任务的 `/api/cron/notifications` 请求。Workers 在同一进程中运行任务，Docker 调度器可自动生成密钥。 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 可选 | 通过 Google 云端硬盘归档 |
| `GOOGLE_MAIL_CLIENT_ID` / `GOOGLE_MAIL_CLIENT_SECRET` | 可选 | 通过 Google OAuth 授权 Gmail 收发邮件 |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | 可选 | 通过 Microsoft OAuth 授权邮箱 |
| `RELAY_PROVIDER`、`RELAY_API_KEY`、`RELAY_API_SECRET` | 可选 | 仅发信中继账户 |
| `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` | 可选 | 网页推送通知 |
| `UPDATE_CHECK` | 可选 | 设为 `off` 可关闭 GitHub 版本检查 |
| `MAIL_LOCALE` | 可选 | 筛选器转发邮件中的标注和默认休假回复使用的语言。默认 `zh-CN`，也可设为 `en` 或 `it`。自定义的休假回复优先。 |

运行以下命令生成加密密钥。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

<a id="1-cloudflare-workers-default"></a>
## 1. Cloudflare Workers（默认）

[部署中文版到 Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/MingToneFurry/WhelkMail) 会直接部署 Worker，按绑定配置创建 D1 数据库，并提示填写 `.dev.vars.example` 声明的两项必填密钥 `APP_PASSWORD` 和 `TOKEN_ENC_KEY`。OAuth、中继和 VAPID 配置默认以注释列出，可稍后补充。定时任务由 `scheduled()` 在 Worker 进程内执行。也可以使用[上游部署入口](https://deploy.workers.cloudflare.com/?url=https://github.com/WhelkMail/WhelkMail)。

使用命令行部署时运行以下命令。

```bash
npm install
npx wrangler d1 create mail-client --binding DB --update-config
npm run db:init:workers:remote

npx wrangler secret put APP_PASSWORD
npx wrangler secret put TOKEN_ENC_KEY

npm run deploy
```

仓库中的 `wrangler.jsonc` 省略了 `database_id`。网页部署工具会分配 D1 数据库并把 ID 写入新的仓库，命令行运行 `wrangler deploy` 时也支持自动分配。如已选择先创建数据库，可用上面的 `--update-config` 将 ID 写入本地配置，提交代码时请排除这个 ID。网页部署流程用 `WRANGLER_CI_OVERRIDE_NAME` 指定自定义 Worker 名称，命令行可以运行 `WORKER_NAME=my-worker npm run deploy`。

`npm run deploy` 会构建前端并执行 `wrangler deploy`。Workers Assets 提供静态文件，`assets.run_worker_first` 将 `/api/*` 交给 Worker，`not_found_handling` 使单页应用的内部链接可以直接访问。

Worker 的 `[triggers] crons` 配置会直接触发通知和同步任务，已包含 `worker/` 独立定时任务提供的功能。

本地开发请在初始化数据库后，分别启动前端和 Worker。

```bash
npm run db:init:workers:local
npm run dev            # Vite 监听 5173 端口
npm run dev:workers    # Worker 使用本地 D1/R2，监听 8787 端口
```

如需 R2，请先创建存储桶，再取消 `wrangler.jsonc` 中 `r2_buckets` 一节的注释。账户也可以把已发送邮件副本保存在 Google 云端硬盘、IMAP 邮箱或邮箱服务商处。

<a id="2-cloudflare-pages"></a>
## 2. Cloudflare Pages

Pages 使用 `functions/api` 下的原生文件路由，`functions/api/_middleware.ts` 为邮件客户端注册 Cloudflare 套接字实现。已有项目可继续使用原配置、D1 数据库、R2 存储桶和密钥。

新建 Pages 项目时运行以下命令。

```bash
npx wrangler d1 create mail-client
# 本地使用 CLI 时将 ID 填入 wrangler.jsonc，或在 Pages 控制台设置 DB 绑定。
npm run db:init:remote
npm run deploy:pages
```

Pages 要求使用标准配置路径。旧安装如果留有本地 `wrangler.toml`，请移除它，改用仓库内的 `wrangler.jsonc` 进行本地配置。生产环境的绑定以 Pages 控制台为准。

控制台操作、自定义域名和 OAuth 配置详见 [Cloudflare 部署指南](CLOUDFLARE.md)。Pages 的同步、通知、筛选规则和休假自动回复由独立的定时 Worker 执行。

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
# 将 APP_URL 设为 Pages 网址。
npm run cron:deploy
```

<a id="3-docker--any-vps"></a>
## 3. Docker 或 VPS 自托管

```bash
cd deploy/docker
cp .env.example .env
# 编辑 .env，填写 APP_PASSWORD、TOKEN_ENC_KEY、PUBLIC_ORIGIN。
docker compose up -d --build
```

默认从宿主机的 `127.0.0.1:8787` 访问容器。在前面配置 Caddy、Traefik 或 nginx 反向代理，并设置 `PUBLIC_ORIGIN=https://mail.example.com`。容器启动时会检查以下两项。

- **`PUBLIC_ORIGIN`** 在 `NODE_ENV=production`（镜像默认值）时必填。固定公开网址可防止客户端通过修改 `X-Forwarded-Proto` 或 `Host` 影响服务对请求来源的判断。
- **`APP_PASSWORD`** 至少包含 10 个字符，且必须更换示例密码。使用 `change-me` 等示例值时，容器会拒绝启动。

<a id="reverse-proxy-requirements"></a>
### 反向代理配置

限流和请求来源校验依赖代理设置的请求头。

- 在 `X-Forwarded-For` 的末尾**追加**客户端地址。Caddy 默认这样处理，nginx 可配置 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`。WhelkMail 读取最后一项，即代理写入的地址。
- 由代理**覆盖** `X-Forwarded-Proto` 和 `X-Forwarded-Host`，确保值来自可信代理。
- 应用端口默认绑定回环地址。若反向代理与应用分别在容器内运行，请移除 `ports:`，改用 `expose: ["8787"]`，并让两个容器加入同一网络。
- 如果代理直接移除 `X-Forwarded-For`，所有请求将共享同一个限流计数。追加客户端地址可按访问者分别限流。

镜像使用 Node 24、内置的 `node:sqlite` 模块和已打包的服务端文件 `dist-server/server.mjs`。运行阶段无需安装 `node_modules` 或编译原生模块。

<a id="data-and-backups"></a>
### 数据与备份

数据库保存在挂载到 `/data` 的卷中，默认路径为 `/data/whelkmail.sqlite`。请备份此卷，其中包含账户、加密凭据、会话、联系人、筛选规则和邮件元数据镜像。

服务启动时会根据 `db/schema.sql` 初始化空数据库，并对已有数据库依次应用 `db/migrations` 中尚未执行的迁移。

<a id="object-storage"></a>
### 对象存储

如需兼容 S3 的对象存储，请配置以下变量。

```env
S3_ENDPOINT=http://minio:9000
S3_BUCKET=whelkmail
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

运行 `docker compose --profile s3 up -d --build` 会同时启动 MinIO。使用 `.env` 中的凭据登录 `http://<host>:9001`，在控制台创建一次存储桶即可。也可以选用 AWS S3、Backblaze B2、Cloudflare R2 的 S3 API 等兼容服务。

界面中此驱动显示为 **S3 / R2**，数据库中保存的名称是 `r2`。在 R2 与 S3 之间迁移数据库时，将对象一并复制到新桶即可继续读取已有记录。

<a id="cron-and-proxy"></a>
### 定时任务与代理

`CRON_ENABLED=true` 时，容器每分钟运行一次通知和同步调度器。调度器使用 `CRON_SECRET` 调用与 Cloudflare 部署相同的受保护接口。省略该变量时，服务会为当前进程生成随机密钥供内部调度器使用。

反向代理后的 `PUBLIC_ORIGIN` 必须与公开访问网址一致，OAuth 回调和安全 Cookie 均依赖此配置。在允许省略 `PUBLIC_ORIGIN` 的开发环境中，代理应正确设置 `X-Forwarded-Proto` 和 `X-Forwarded-Host`。

使用 SQLite 时只运行一个容器实例。除 IMAP/SMTP、OAuth 和可选的 S3 存储外，其余工作均在本地进程中完成。

<a id="verifying-a-deployment"></a>
## 验证部署

公开的健康检查接口会报告已配置的可选服务。

```bash
curl -s https://mail.example.com/api/health
```

登录后在“设置 → 账户”中添加邮箱，点击“测试连接”。首次打开邮箱时，应用将开始同步邮件元数据。

<a id="moving-a-configuration-to-another-installation"></a>
### 将配置迁移到另一套 WhelkMail

“设置 → 系统 → 配置导出与导入”可生成一个 JSON 文件，包含账户、筛选规则、标签、联系人、通知偏好和应用设置。导出时，程序会先解密账户密钥（IMAP/SMTP 密码、OAuth 令牌、中继和云端硬盘密钥），再用你指定的口令加密整个文件（PBKDF2-SHA256 + AES-256-GCM）。因此，即便目标部署的 `TOKEN_ENC_KEY` 不同，也可以还原配置。

导入操作会覆盖目标部署的配置，使用目标部署的 `TOKEN_ENC_KEY` 重新加密密钥，并清空本地邮件镜像。原始邮件保存在服务商处，下次同步会重建镜像。导入后会保留目标部署的会话、双因素认证设置以及 R2/云端硬盘归档。请妥善保管导出口令，遗失后将无法解密文件。

在 Workers 上，密钥派生会占用 Worker 的 CPU。配置文件较大时容易超过 Workers Free 单次请求的 CPU 限额，可使用 Docker 或 Workers 付费方案执行导入和导出。

<a id="updating"></a>
## 更新版本

- **Workers**：拉取目标发布版本，按发布说明更新 `wrangler.jsonc`，执行 `npm run db:migrate:workers:remote`，再运行 `npm run deploy`。
- **Pages**：拉取目标版本，执行 `npm run db:migrate:remote`，然后重新部署 Pages 项目。
- **Docker**：拉取目标版本，运行 `docker compose up -d --build`。数据库迁移会在启动时执行。
