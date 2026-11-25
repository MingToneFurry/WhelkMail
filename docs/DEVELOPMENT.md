<a id="development-and-publishing"></a>

# 开发与发布

本页介绍 WhelkMail 的开发流程、上游开发仓库与发行仓库的关系，以及发布前需要检查的文件。

<a id="repositories"></a>

## 仓库

下表是上游维护者使用的远程仓库命名。本地克隆个人 fork 后，`origin` 通常指向自己的 fork。执行发布命令前，用 `git remote -v` 核对目标仓库。

| 上游仓库 | 用途 |
| --- | --- |
| `mlzog/WhelkMail`（上游维护者的 `origin`） | 日常开发。可以频繁提交较小的改动，也可以保留中间状态。 |
| `WhelkMail/WhelkMail`（上游维护者的 `public`） | 对外发行，供所有人安装。 |

两个上游仓库共享同一条提交历史。统一历史的合并完成后，`public/main` 成为开发分支的祖先，因此可以通过普通合并和快进推送来同步。在 GitHub 上合并拉取请求后，执行 `git merge public/main` 即可将其合回开发分支。若使用 cherry-pick，相同的内容会多出一次提交。

<a id="local-setup"></a>

## 本地开发环境

安装 Node.js 24 或更高版本及 npm。Node 入口依赖内置的 `node:sqlite`，Docker 镜像使用 Node 24。

```bash
npm install
npm run db:init:local   # 初始化全新本地数据库：创建表结构并登记迁移基线
```

仓库中的 `wrangler.jsonc` 定义了本地绑定，D1 ID 使用占位值。如果本地还保留旧的 `wrangler.toml`，请移除它。Pages 要求使用默认配置路径，公开仓库需要保留 D1 占位值。

创建已被 Git 忽略的 `.dev.vars`，至少写入以下配置，将示例值替换为本地值。

```env
APP_PASSWORD=change-me
TOKEN_ENC_KEY=<32-byte base64 key>
```

用以下命令生成 32 字节的随机密钥，并以 Base64 输出。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

打开两个终端，分别运行以下命令。

```bash
npm run dev       # Vite 开发服务器：http://localhost:5173
npm run dev:api   # Pages Functions：http://localhost:8788
```

访问 `http://localhost:8788`。Functions 会将前端请求代理到 Vite 开发服务器。

使用 Workers 或 Node 时可执行以下命令。

```bash
npm run db:init:workers:local
npm run dev            # Vite 开发服务器
npm run dev:workers    # Worker 和本地 D1：http://localhost:8787

npm run build:all
APP_PASSWORD=... TOKEN_ENC_KEY=... DB_PATH=./data/dev.sqlite \
  PUBLIC_ORIGIN=http://localhost:8787 node dist-server/server.mjs
```

Node 入口使用 Node 24 内置的 `node:sqlite`，启动时会创建数据库或迁移现有数据库。Pages、Workers 和 Node 共用 `server/`、`functions/api` 和 `functions/_lib`。`functions/api` 下的每个端点文件都必须在 `server/routes.ts` 中有一条对应的路由，测试会检查这一点。

<a id="working-from-the-acode-terminal-on-android"></a>

### 在 Android 上使用 Acode 终端

Acode 的 Alpine 终端默认没有 Node，可以用以下命令安装。

```bash
apk add nodejs npm
```

Alpine 使用 musl。`wrangler dev` 和 `wrangler d1 --local` 所需的 `workerd` 二进制程序可能无法在该环境中运行。`typecheck`、`lint`、`test` 和 `build` 可以正常执行。如果需要真正的 Worker 运行环境，可将代码推送至 GitHub，并使用 Cloudflare Pages 预览部署。

<a id="database-changes"></a>

## 数据库变更

- `db/schema.sql` 用于**全新安装**，应包含当前完整的表结构与所有列。
- `db/migrations/NNN_name.sql` 用于升级**现有数据库**。迁移文件通过 `ALTER` 或 `CREATE` 添加结构，重复执行可能报错。全新数据库应使用初始化命令。
- `npm run db:migrate:local` 和 `db:migrate:remote` 按顺序运行缺少的迁移，并将每一项登记在 `schema_migrations` 中。重新运行时会跳过已完成的迁移，升级中断后可接着执行。
- `npm run db:init:local` 和 `db:init:remote` 用于**新数据库**。它们应用 `schema.sql`，再把当前已有的迁移登记为基线，之后首次升级即可直接执行迁移。
- `npm run db:local` 和 `db:remote` 仅应用 `schema.sql`。对现有数据库执行这些命令后，切勿直接使用 `--mark-applied`。`CREATE TABLE IF NOT EXISTS` 无法向已有表添加列，直接登记会将尚未执行的迁移标记为完成。脚本在发现对应的列或表缺失时会拒绝登记。
- 部分旧数据库的结构已完整，但创建时间早于迁移登记机制，因此登记表为空。此时脚本会暂停，并提示选择 `--mark-applied`（仅登记全部迁移）或 `--from=NNN`（从指定编号开始执行）。
- D1 会逐条运行同一文件中的语句。如果执行到一半失败，该文件已部分生效，但尚未登记。脚本会打印恢复命令。`--only=NNN` 单独重跑该文件；确认该文件应有的变更已全部就位后，可用 `--only=NNN --mark-applied` 登记。
- `--mark-applied` 会在登记前验证各项迁移创建的列、表和索引，有缺失就拒绝登记。涉及 `UPDATE` 或 `DELETE` 的数据变更需要人工核实。
- `--dry-run` 仅显示执行计划，可用于预览。

新增表或列时，请**同时**更新 `db/schema.sql` 并添加迁移文件。

<a id="tests"></a>

## 测试

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

每次向 `main` 推送或创建拉取请求时，CI 都会运行这四项检查。如果发现 Git 跟踪了个人配置文件，CI 也会报错。

<a id="releases"></a>

## 发行版本

`package.json` 中的版本号和 `shared/version.ts` 中的 `APP_VERSION` 需要保持一致，测试会检查两个值。

1. 将两处版本号更新为新的语义化版本号。
2. 运行上述四项检查，再发布到公开仓库。
3. 创建并推送标签，然后在 GitHub 上创建发行版。

   ```bash
   git tag v1.2.3
   git push public v1.2.3
   ```

   在上游流程中，维护者从标签创建发行版。如果是测试版，请标记为预发行版（pre-release），这样 `/releases/latest` 会跳过该版本，现有部署也不会收到升级提示。[上游发行页](https://github.com/WhelkMail/WhelkMail/releases)
4. 在发布说明中注明是否新增数据库迁移。

每个部署都会将其 `APP_VERSION` 与最新发行版本比较，结果在 D1 中缓存一天。如果有更新，应用会显示升级步骤。从两个正式版本之间的提交构建时，版本号仍可能与上一标签相同，直到发布下一版本才会出现更新提示。请保持仓库的 `main` 和发行标签同步，以便版本比较反映实际发布状态。

<a id="publishing-to-the-public-repository"></a>

## 发布到上游公开仓库

上游维护者首次使用发布脚本时，先配置发行仓库。

```bash
git remote add public https://github.com/WhelkMail/WhelkMail.git
git fetch public
```

按需要选择分支并发布。

```bash
sh scripts/publish-public.sh                  # 发布 main
SOURCE=feature-x sh scripts/publish-public.sh  # 发布其他分支
```

若 `SOURCE` 分支跟踪了个人配置文件，脚本会拒绝发布。检查范围包括 `wrangler.toml`、`worker/wrangler.toml`、`.dev.vars` 及其变体（如 `.dev.vars.production`、`.dev.vars.production.local`），以及 `.env` 和带有任意层后缀的 `.env.*`。仓库允许并应当保留 `*.example` 模板。

脚本会将 `SOURCE` **快进推送**到 `public/main`。若 `public/main` 上有本地缺少的提交，脚本会停止，并要求先合并。

```bash
git merge public/main        # 将 GitHub 上已合并的拉取请求同步回开发分支
sh scripts/publish-public.sh # 再次以快进方式发布
```

定期执行 `git fetch public` 更新本地的 `public/main`。只要有人在公开仓库合并拉取请求，就可能出现本地分支尚未包含的提交。发布前执行以下检查，确认公开仓库可以安装。

```bash
git ls-files | grep -E 'wrangler\.toml$|\.dev\.vars' && echo "unexpected config"
npm ci && npm run typecheck && npm run test && npm run build
```

公开仓库中应排除以下内容。

- `wrangler.toml` 和 `worker/wrangler.toml`。它们可能包含 URL 和账号专属的资源标识符。已跟踪的 `wrangler.jsonc` 必须保留占位用的 `database_id`，方便使用“部署到 Cloudflare”按钮或 fork 的用户自行配置。
- `.dev.vars`、`.env*` 中的个人配置及任何密钥。
- `node_modules/`、`dist/`、`.wrangler/`（本地 D1 状态）和 `coverage/`。
- 种子数据。`db/schema.sql` 只应包含创建结构的 `CREATE` 语句，不要通过 `INSERT` 写入真实账号、联系人或邮件。

用 `git ls-files` 检查 Git 实际跟踪的文件；推送时发布的是这些已提交的文件。

<a id="notification-assets"></a>

## 通知图标

`public/notification-badge.png`（96 × 96）和 `public/notification-icon.png`（192 × 192）根据 `public/whelkmail-logo.svg` 中的贝壳标志生成。

```bash
npm run icons
```

Android 会将 `badge` 蒙版处理为状态栏中的单色轮廓，并且无法在该位置渲染 SVG。因此两个图标都采用 PNG，状态栏徽标使用透明背景上的白色图形。为保证小尺寸下的辨识度，徽标省略了标志中的细装饰线条。替换图标后，请更新 `public/sw.js` 的 `CACHE`，让已安装的客户端获取新资源。

<a id="where-things-live"></a>

## 目录说明

| 路径 | 内容 |
| --- | --- |
| `src/` | React 应用，状态机位于 `App.tsx`，界面组件位于 `components/` |
| `functions/api/` | API 端点处理函数。Pages 使用原生路由，Workers 和 Node 通过 `server/routes.ts` 导入 |
| `functions/_lib/` | IMAP/SMTP、数据库访问、同步、缓存、过滤器和加密 |
| `server/` | 独立于运行环境的 API 分发器、路由表及 Workers、Node、SQLite、S3 适配器 |
| `server/entries/` | Workers 和 Node 的入口文件（Pages 使用原生路由） |
| `deploy/docker/` | Dockerfile、Compose 配置文件和环境变量示例 |
| `shared/` | 前后端共用的类型、数据结构定义、预设和分页辅助函数 |
| `worker/` | Pages 部署使用的定时任务 Worker（`index.ts` 和配置示例） |
| `db/` | 数据库结构和迁移文件 |
| `scripts/` | VAPID 密钥、数据库迁移、Worker 配置和发布辅助脚本 |
| `tests/` | Vitest 测试套件 |
