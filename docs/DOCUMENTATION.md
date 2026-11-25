<a id="whelkmail--technical-documentation"></a>

# WhelkMail 技术文档

本文介绍系统架构、安全模型、邮箱操作和数据存储。

> [部署指南](DEPLOYMENT.md)列出了 Workers、Pages 和 Docker 三种部署方式的差异。使用 Cloudflare 时，请参阅 [Cloudflare 配置指南](CLOUDFLARE.md)，其中包含控制台操作、命令、绑定、密钥、OAuth 设置、验证和故障排查步骤。

<a id="1-scope"></a>

## 1. 功能范围

WhelkMail 是**网页邮件客户端**。

- 通过 IMAP 和 SMTP 连接已有邮箱。
- 邮件由邮箱服务商接收。WhelkMail 不运行邮件传输代理（MTA），也不在 25、143、993、465、587 端口监听。
- 邮箱仍由服务商创建和管理。Thunderbird、手机邮件客户端等可以同时独立连接同一个邮箱。
- 对于没有 SMTP 服务的域名，可以添加**仅发信的中继账户**。它通过 HTTP 邮件 API 发信，已发送邮件和草稿可保存在 Google 云端硬盘、Cloudflare R2 或另一 IMAP 账户的对应文件夹。Cloudflare Email Service 中继属于实验功能，上游维护者尚未用实际 Cloudflare 账户完成验证。

<a id="2-architecture"></a>

## 2. 架构

```text
浏览器（React/Vite）
        |
        | HTTPS，同源 /api
        v
API 核心（server/app.ts 和 functions/api 下的处理器）
        |
        +-- Cloudflare Workers（默认）：D1、R2、cloudflare:sockets、定时触发器
        +-- Cloudflare Pages：D1、R2、cloudflare:sockets、worker/ 下的定时任务
        +-- Docker / Node 24：SQLite（node:sqlite）、S3、node:net/tls、内置定时任务
        |
        +-- OAuth：Google 和 Microsoft（XOAUTH2）、Google 云端硬盘（归档）
        +-- HTTP 中继 API（仅发信账户）
```

三种部署方式共用 `functions/api` 下的接口。`server/app.ts` 提供与 Pages 的 `_middleware.ts` 相同的身份认证、来源校验和安全响应头中间件。`server/routes.ts` 把各处理器映射给 Workers 和 Node 的请求分发器，Pages 则沿用原生的文件路由。运行时差异由适配器处理，包括 D1 和 `node:sqlite`、共用 `put/get/delete` 接口的 R2 和 S3 存储桶，以及 `cloudflare:sockets` 和 `node:net`/`node:tls`。

运行时有以下约束：

- 浏览器无法直接使用 IMAP/SMTP，访问邮箱的流量均经过 API 后端。
- Cloudflare Workers 使用 `cloudflare:sockets` 建立**出站** TCP 连接，不接受入站 TCP 连接。Node/Docker 通过 `node:net`/`node:tls` 建立相同的出站连接。
- Cloudflare 封锁 25 端口，本应用不使用该端口。
- 不同请求之间无法保持 IMAP `IDLE` 会话。进入页面、发信完成或重新载入页面时，界面会刷新邮箱内容。

<a id="3-request-flows"></a>

## 3. 请求流程

<a id="list-messages"></a>

### 列出邮件

1. `GET /api/messages?accountId=all&folder=inbox`
2. 列表优先读取 D1 镜像。首次访问尚未同步的文件夹时，从 IMAP 读取最新邮件头来初始化列表。已有镜像过期时，立即返回缓存列表，同时安排后台同步。
3. 同步时从 `SELECT` 的结果中读取 `UIDNEXT`，获取新 UID，并分批回填有限范围内的历史邮件，避免每次都执行 `UID SEARCH ALL`。服务端在本地解析 `BODYSTRUCTURE` 来判断有无附件，无须下载正文。
4. 使用 `postal-mime` 解析邮件头，合并所有账户的结果并排序。中继账户提供 D1 的 `messages` 表中对应的记录。
5. 合并时通过 `compareByDateDesc` 先按 `sent_at` 降序排列，再按 `id` 降序排列。该顺序与 SQL 的 `ORDER BY sent_at DESC, id DESC` 和键集分页游标 `sent_at < ? OR (sent_at = ? AND id < ?)` 一致。若时间相同时改按 ID 升序，两封时间戳相同的邮件可能被重复返回，客户端用 `mergePage` 去重后，邮件就可能从列表中消失。
6. 返回响应后，服务端使用同一个 IMAP 连接执行 `UID FETCH ... (BODY.PEEK[])`，预取最新邮件的正文并写入 D1 正文缓存。统一视图每个账户预取一封，单个账户视图最多预取三封。

<a id="search"></a>

### 搜索

1. `GET /api/messages/search?q=...` 从 D1 镜像返回匹配的邮件以及联系人。邮件搜索覆盖收件箱、已发送、草稿、垃圾邮件，也可限定为单个文件夹。
2. 查询通过 `lower(column) LIKE ?` 做不区分大小写的**子串匹配**。不做全文分词、词干提取或模糊匹配。每个搜索词都必须出现在被检索的列中，包括 `subject`、`snippet`、`from_email`、`from_name`、`to_json`、`cc_json`，以及 `search_text` 或 `body_text`。
3. `imap_messages.search_text` 最多保存 4,000 个正文字符，在打开邮件、归档或回填摘要时解析正文并填入。因此，只有已建立正文索引的邮件才能按正文词语查到。其余邮件仍可按发件人、收件人或主题查找。中继账户的邮件通过已保存的 `body_text` 搜索。
4. 搜索结果使用与列表接口相同的（日期、ID）游标和合并顺序分页。

<a id="read-a-message"></a>

### 阅读邮件

1. `GET /api/messages/:id`
2. ID 中包含账户、文件夹和 UID（`i_<account>.<folder>.<uid>`），中继账户记录使用 `r_<uuid>`。
3. 原始 MIME 数据依次从 D1 正文缓存、R2/Drive 归档和 IMAP 读取。从归档或 IMAP 取回的正文会写入 D1 缓存（最大 512 KB），以加快下次打开邮件或请求附件的速度。
4. 接口返回纯文本、HTML 和附件元数据。收件箱及垃圾邮件中的邮件会标记为 `\Seen`。命中缓存或归档时，立即更新 D1，然后异步更新邮箱服务商一侧的标记，HTTP 响应无须等待第二次 IMAP 连接。
5. 客户端在沙箱 iframe 中渲染 HTML，使用严格的 CSP 并禁用脚本、表单。远程图片默认阻止加载，可为单封邮件启用。较小的 `cid:` 图片以 data URI 嵌入详情响应，较大的图片通过需要身份验证的附件接口获取。

<a id="message-actions"></a>

### 邮件操作

1. 调用 `POST /api/messages/actions`，传入 `{ ids, action: "delete" | "spam" | "move", target?: "inbox" | "spam" | "trash" }`。
2. IMAP 邮件按账户、文件夹分组。每组使用同一个连接，通过 `UID COPY` 将指定 UID 的邮件复制到目标文件夹，再用 `UID STORE +FLAGS (\Deleted)` 和 `UID EXPUNGE` 从源文件夹移除。
3. 删除操作将邮件移入邮箱服务商的已删除文件夹。标记垃圾邮件将其移入 `\Junk` 文件夹，取消垃圾邮件标记则移回收件箱。
4. 更新 D1 镜像并将源文件夹、目标文件夹加入同步队列。移动的记录暂时保留在 D1，等目标文件夹同步通过 `stable_key` 转移标签后，再由源文件夹同步清除旧记录。

<a id="send"></a>

### 发送邮件

1. `POST /api/messages/send`
2. 服务端构建完整的 MIME 邮件。
3. **IMAP 账户**通过该账户自己的 SMTP 服务器验证身份并发信。
4. 如果 `auto_saves_sent` 为 false，服务端将同一份 MIME 邮件追加到服务商的「已发送」文件夹（优先查找带 `\Sent` 标记的文件夹，找不到时使用 `Sent`）。
5. 如果请求带有 `draftId`，服务端会删除原草稿。
6. **中继账户**使用 `storage_driver` 指定的目标保存 `.eml` 副本，通过选定的 HTTP 中继发信，并在 D1 中记录元数据。副本的写入时机取决于存储方式。
   - 使用 `drive` / `r2` 时，先将副本写入对象存储，再发送邮件。因此即使发送失败，副本依然存在。
   - 使用 `imap` 时，中继接受邮件后，系统将同一份 MIME 邮件追加到 `sent_copy_account_id` 指定账户的「已发送」文件夹，把引用（`imap:<account>:<folder>:<uid>`）存入 `storage_key`，并将该账户的「已发送」文件夹加入同步队列。正常流程无需写入对象存储。若追加失败，邮件已经发出，系统仍会记录这次发送。如果部署已连接 Drive 或配置了 `BUCKET` 绑定，就将 MIME 邮件写入对应的对象存储作为备用副本，并在 `messages.storage_driver` 中记录实际使用的存储方式。这样仍能访问附件和原始邮件。如果未配置对象存储，D1 中仅保留正文，响应会附带警告。

<a id="reply"></a>

### 回复邮件

1. 回复编辑器通过 `pickReplySender` 按以下优先级选择发件账户：
   - 首先使用实际收信邮箱的 `accounts.reply_account_id`，即用户为该邮箱明确指定的回复账户。
   - 其次查找其地址与实际投递别名匹配的账户。`aliasAddresses()` 从上到下依次读取 `Delivered-To`、`X-Delivered-To`、`X-Original-To`、`Envelope-To`、`X-Envelope-To`、`X-Forwarded-To`、`X-Forwarded-For`（Cloudflare Email Routing）、`Resent-To`、`Apparently-To` 和 `Received … for <addr>` 中的地址，客户端还会检查邮件的 To/Cc。候选账户必须具备发件能力，即已配置中继或已连接 IMAP。如果没有账户与该地址完全匹配，则查找别名所属域下已启用 `relay_any_address` 的中继账户（见第 2 步）。这两种匹配都经过 `pickReplyAccount()`（`shared/from-address.ts`）的校验。接收服务器验证了相应域名后，系统才采用转发邮件头，取第一个能匹配账户的可信邮件头。To/Cc 中则必须恰好有一个可匹配的地址。
   - 然后使用全局「回复发件人」偏好设置（默认值为 `auto`）。
   - 最后使用实际收到邮件的账户。

   别名匹配使转发域也能像 Gmail 那样选用回复身份。例如，发给 `EMAIL@DOMAIN.IT` 的邮件转发到 `EMAIL@PROVIDER.IT` 后，邮件头里仍保留原收件地址，回复时便可使用原域名的账户。
2. 如果选中的是中继账户，且已启用**允许使用此域名下的任意地址发信**（`accounts.relay_any_address`），就可以使用与账户域名完全相同的原收件地址回复。`shared/from-address.ts` 中的 `pickDomainAlias()` 按以下顺序选择：
   - 当接收服务器写在最上方的 `Authentication-Results` 表明该域名的 DKIM 签名验证通过时（`verifiedDomains()`），按从上到下的顺序取 `aliasAddresses()` 中该域名的首个地址。Cloudflare Email Routing 使用转发域名为邮件签名。邮件若直接投递到邮箱，就没有这份转发签名，系统会忽略其中伪造的 `X-Original-To`。转发路径中的服务器都将自己的邮件头加在最前面，因此转发服务写入的记录（例如 Cloudflare 的 `X-Forwarded-For` 和 `Received … for`）排在原发件人写入的所有邮件头之前。
   - 如果上一步没有选出地址，检查 To/Cc。只有其中恰好出现一个属于该域的地址时才采用它。
   - 其余情况使用账户自身的地址。

   配置多个此类中继时，`pickReplyAccount()` 先在所有中继中匹配可信转发头，再检查 To/Cc。只有 To/Cc 在所有中继域和账户中恰好匹配一个地址时才有效。共享域名时，收信邮箱自己的地址常出现在邮件头最上方；查找别名时会跳过它。邮件若只发给收信邮箱本身，就由该账户回复。在「已发送」中回复邮件时，会保留原发件地址，因为这里的 To/Cc 记录的是收件人。中继账户自己的已发送副本也由该中继回复。系统只提供发送端点能接受的地址。例如，`shop=orders@DOMAIN.IT` 会被完整读取，并因不符合要求而跳过，系统不会把它截成 `orders@DOMAIN.IT`。如果两个中继都允许从**同一个域名**发件，别名的归属就会产生歧义。此时 WhelkMail 不提供该别名，回复使用所选账户自己的地址，避免依账户排列顺序决定发件身份。

   编辑器在 From（发件人）列表中单独显示匹配到的地址，发送前可以切回原发件身份。`POST /api/messages/send` 通过 `fromEmail` 接收发件地址。该地址必须是账户自己的地址，或在开启上述选项时属于完全相同的域名（不含子域名），否则返回 `from_address_not_allowed`。MIME 邮件的 From、中继请求和存储的已发送副本都使用这一地址。草稿只记录账户，重新打开草稿后再发送会使用账户自身的地址。
3. 其余步骤与普通发送流程相同。回复通过所选账户自己的 SMTP 或中继发送，副本保存到该账户配置的目标。To/Cc 会排除收信账户和发件账户的地址，避免回复给自己。

<a id="conversations"></a>

### 会话

1. `GET /api/threads?accountId=&folder=` 每个会话返回一行。分组键为 `COALESCE(thread_key, stable_key)`，因此启用会话功能之前已写入镜像的邮件，在历史数据回填前也能显示。
2. 分页使用 `(last message date, thread key)`（最后一封邮件的时间和会话键）作为组合游标。查询先在指定范围内根据 `HAVING last_at < ? OR (last_at = ? AND key < ?)` 确定当页会话，再**从该账户的所有文件夹中读取这些会话的邮件**（草稿除外），汇总出每行的最新邮件、未读数、标签和去重后的发件人。列表采用类似 Gmail 的显示形式（如 `Mario, Luca +2  5`）。即使回复保存在“已发送”中，也会计入该会话。
3. 每个账户独立划分会话。两个邮箱中主题相同的邮件各自形成会话，统一视图会分别列出。
4. 排序和游标均使用与 SQL 相同的组合键 `(last_at, thread key)`，时间戳相同的会话在翻页时也不会重复或遗漏。
5. `GET /api/threads/messages?accountId=&threadKey=` 按列表使用的 `COALESCE(thread_key, stable_key)` 匹配（中继记录使用 `'r:' || id`），从旧到新返回整个会话，包括该账户收件箱、已发送和垃圾邮件中的邮件，排除草稿。自己的回复也显示在会话内。阅读窗格为每封邮件显示一行摘要，包含发件人、正文片段和日期。当前邮件的正文在摘要下方展开，单击其他行即可就地加载对应邮件。
6. 此接口**不执行 IMAP 操作**，只报告 `syncing`、`staleAccounts`（镜像已超过 TTL 的 IMAP 账户）和 `activeAccounts`（已持有同步锁的过期文件夹）。列表显示后，`useEffect` 调用 `pickSyncRequests()`（`src/lib/sync-queue.ts`），按 `accountId:folder` 分别计时，切换文件夹时无需等待上一个文件夹的冷却期。每次最多选取三个文件夹，跳过已锁定或最近 3 秒内请求过的文件夹。每个选中的文件夹由 `runSyncChain()`（`src/lib/sync-chain.ts`）驱动。只要响应含有值为真的 `hasMore`，就继续调用 `POST /api/accounts/:id/sync`。发生错误、其他工作进程持有锁（`locked`）、达到 30 批上限或连续 3 批的 `progress` 没有增长时，本轮同步停止。进度按镜像记录数**加上已归档的正文数**计算，因此即使归档时未向 D1 添加记录，也能识别正常进展；归档写入失败时进度会保持不变。文件夹可由此同步至 `done`，无需定时任务或刷新列表。`partial` 表示还有数据待取。各账户并行查询，每个请求记录一行 `[threads] … ms=` 日志。加载当前页会话时，按**每个会话**分别设定上限（`ROW_NUMBER() OVER (PARTITION BY key …) <= 40`），单个长会话不会挤掉其他会话。即使只加载部分历史记录，每个键的 `COUNT(*)` 和 `SUM(unread)` 仍按全部记录准确统计。若本轮同步因达到批次上限或其他工作进程持锁而结束，且尚未达到 `done`，客户端会在短暂等待后启动下一轮（`nextChainDelay` 通常为 500 毫秒，遇到锁时为 5 秒）。每个文件夹同时只保留一条同步链，大邮箱也可以分轮同步至 `done`。同步链在浏览器中运行，关闭标签页时文件夹会保留部分同步状态，下次加载或定时任务运行时继续。若同步停滞，客户端停止调度并向用户显示提示。
7. `thread_key` 是会话根邮件的 Message-ID，由 `threadKeyFor()` 按 `References[0]`、`In-Reply-To`、邮件自身 Message-ID 的顺序选取。应用内撰写的回复会生成 `In-Reply-To` 和 `References`，客户端可据此将回复副本归入会话。同批处理会补齐父邮件记录缺少的键，后续同步分批重读仍缺键记录的邮件头。
8. 标签视图与搜索结果也按会话分组。标签视图会加载带该标签的整个会话（`GET /api/threads?labelId=`）。搜索会将同一会话中匹配的邮件折叠为一行，行内计数只统计当页匹配的邮件。删除会话行时，操作对象是该行显示的最新一封邮件。
9. 邮件缺少 `References` 和 `In-Reply-To` 时（例如引用链中断或经过转发的副本），`normalizeSubject()` 会移除 `Re:`、`R:`、`AW:`、`SV:`、`Fwd:` 等前缀，沿用库中同主题邮件所属的会话。这与 Gmail 的后备匹配方式相同。只有主题带回复前缀的邮件才参与匹配，因此两封碰巧同名的独立邮件仍各有自己的会话。查找父邮件时也会搜索并修复 `messages` 表中的记录，从应用发出邮件所收到的回复也能归入正确会话。批量重建时按主题合并也遵循同一规则。
10. 在“设置 → 系统 → **会话**”中可以查看各账户有多少封镜像邮件尚无会话键，并批量重建会话（`GET/POST /api/threads/rebuild`，每次调用只处理 200 封邮件的邮件头）。这一功能适合历史邮件较多、逐批增量处理耗时较长的邮箱。

<a id="drafts"></a>

### 草稿

- **IMAP 账户**使用 `APPEND` 将草稿写入 `\Drafts` 文件夹，并设置 `\Draft \Seen` 标志。删除时依次执行 `UID STORE +FLAGS (\Deleted)` 和 `EXPUNGE`。
- **中继账户使用 `storage_driver = 'drive' | 'r2'` 时**，MIME 原文写入对象存储归档。Drive 中的路径为 `drafts/<id>.eml`，R2 中的路径为 `accounts/<id>/drafts/<id>.eml`。元数据写入 D1，并标记为 `folder='draft'`。
- **中继账户使用 `storage_driver = 'imap'` 时**，草稿追加到 `sent_copy_account_id` 指定账户的草稿箱，行为与在该账户中写草稿相同。常规写入仅使用该邮箱。
  - 系统按**目标账户**的配置查找草稿箱。先读取该账户的 `drafts_folder`，再查找带有 `\Drafts` 特殊用途标志的文件夹，最后尝试已知名称（`Drafts`、`INBOX.Drafts`、`INBOX/Drafts`、`Bozze`、`INBOX.Bozze`、`Bozza`、`INBOX.Bozza`、`Draft`、`INBOX.Draft`）。文件夹缺失时，先执行 `CREATE`，再重试追加。
  - 写入标志为 `(\Draft \Seen)`。服务器支持 UIDPLUS 时，从 `APPENDUID` 获取 UID。其余情况使用该文件夹的 `UIDNEXT - 1` 或搜索返回的最大 UID。
  - `messages` 表中的记录保存 `folder='draft'` 和 `storage_driver='imap'`，并在 `storage_key` 中保存指针（`imap:<accountId>:<encodedFolder>:<uid>`）。重新打开草稿时使用 `UID FETCH` 取回邮件。自动保存会追加新版并清除旧副本，删除或发送草稿则会移除目标邮箱中的副本。
  - 此模式只在需要补救时使用 Drive/R2。目标账户缺失或未连接时，保存会返回 `sent_copy_target_not_connected`。若 APPEND 失败且有可用的对象存储，系统会把草稿补存到那里，并在 `messages.storage_driver` 中记录实际位置。没有对象存储时，保存会返回 `draft_save_failed`。写信窗口会显示错误，用户确认后仍可关闭。
  - 目标账户中的邮箱副本会按普通草稿建立镜像（`i_<account>.draft.<uid>`）。草稿列表和搜索会过滤掉这些 ID（`relayDraftMirrorIds` → `draftMirrorIdsFromPointers`），使每封草稿只在所属中继账户下显示一次。保存或删除草稿时，目标草稿箱会加入同步队列，镜像随即反映刚刚追加或清除的副本。过滤在 SQL 的 `LIMIT` 之前进行，以免分页之后再过滤导致页面缺少条目、丢失下一页游标。D1 将每条语句的绑定参数限制为 100 个，而一个邮箱可能有大量副本，因此查询以通过验证的字面量直接写入 ID，只接受符合 `i_<account>.<folder>.<uid>` 格式的 ID，每次最多 500 个。
- 自动保存在最后一次改动后 5 秒执行。如仍有待保存的改动，每隔 30 秒执行一次。关闭写信窗口时会先保存待处理的更改，若保存失败，会询问是否放弃草稿。
- 手动点击**保存草稿**会关闭写信窗口并打开草稿箱。
- 写信窗口支持富文本（粗体、斜体、下划线、删除线、列表、引用和链接），也可使用纯文本。MIME 邮件和草稿中同时保存 `html` 与 `text`。默认模式按设备记录（`localStorage: mc_compose_rich`），电脑与手机可以各自设置。粘贴时只保留少量允许的标签，并清理链接。
- 草稿箱**逐封列出草稿**，即使草稿带有现有会话的标识，也会单独占一行。会话查询会排除 `folder = 'draft'`，草稿箱因此采用专用查询，避免列表始终为空。存入其他邮箱的中继草稿也只在所属中继账户下列出一次。

<a id="where-a-send-only-account-keeps-its-copies"></a>

### 仅发信账户的副本存储位置

每个中继账户通过 `storage_driver` 选择**一个**存储位置，已发送副本和草稿共用此设置。选择邮箱存储时，常规写入只使用目标邮箱。

| `storage_driver` | 已发送副本 | 草稿 | 前提条件 |
| --- | --- | --- | --- |
| `drive` | Google Drive 上的 `sent/<id>.eml` | Google Drive 上的 `drafts/<id>.eml` | 已连接 Google Drive |
| `r2` | R2 中的 `accounts/<id>/sent/<id>.eml` | R2 中的 `accounts/<id>/drafts/<id>.eml` | 已配置 `BUCKET` 绑定 |
| `imap` | 使用 `APPEND` 写入目标账户的已发送文件夹 | 使用 `APPEND` 写入目标账户的草稿箱 | `sent_copy_account_id` 指向已连接的 IMAP 账户 |

切换回 `drive` 或 `r2` 会清空 `sent_copy_account_id`。写入邮箱的副本是保存在服务商处的实际邮件。删除账户会保留这些副本，通过应用删除邮件则会一并移除对应存储位置的副本。每封邮件都记录写入时的目标位置，因此更换存储位置后，旧副本仍可从原位置读取和删除。

以 IMAP 邮箱为目标时，每封已发送副本也会在目标账户的已发送文件夹中建立镜像。系统根据中继指针推导镜像 ID（`relaySentMirrorIds` → `sentMirrorIdsFromPointers`），在已发送列表、会话计数和搜索结果中排除这些镜像 ID，使邮件只在中继账户下列出一次。删除合并后的条目会同时移除实际邮件和镜像记录。移动该条目时，系统会在目标邮箱中移动实际邮件，移除中继记录并安排同步，此后由目标账户在新文件夹中的镜像记录表示该邮件。只有具备邮箱指针的中继记录才支持移动。

<a id="4-project-structure"></a>

## 4. 项目结构

```
functions/                 Cloudflare Pages Functions
  _lib/
    imap/client.ts         基于 cloudflare:sockets 的 IMAP 客户端
    smtp/client.ts         SMTP 客户端（PLAIN、LOGIN、XOAUTH2）
    mail/                  身份验证辅助函数、文件夹查找、草稿处理和邮件加载
    mime.ts                MIME 邮件生成器
    storage/               Drive 和 R2 存储适配器
    relay/                 HTTP 发信中继适配器
    microsoft/oauth.ts     Microsoft OAuth2 / XOAUTH2 令牌流程
  api/                     HTTP 接口（Pages 原生路由和共享路由表）
server/                    跨运行环境的请求分发器，以及 Workers 和 Node 的入口与适配器
deploy/docker/             Dockerfile、Compose 文件和环境变量示例
shared/                    类型、Zod 校验规则、服务商预设和分页辅助函数
src/                       React 应用
db/schema.sql              全新安装所需的 D1/SQLite 数据库结构
db/migrations/             现有数据库的增量升级
wrangler.jsonc             Workers 与 Pages 共用的配置（自动创建 D1）
worker/wrangler.toml.example  Pages 定时任务 Worker 模板（Git 忽略实际配置文件）
```

<a id="5-data-model"></a>

## 5. 数据模型

### `accounts`

每个已接入的邮箱身份占一行。主要字段如下。

- `kind` 取值为 `imap` 或 `relay`。
- `imap_host`、`imap_port`、`imap_security`、`smtp_host`、`smtp_port`、`smtp_security` 分别指定收发信的主机、端口和连接安全设置。
- `username` 为登录用户名。
- `auth_type` 取值为 `password` 或 `oauth2`。
- `secret_enc` 保存加密后的密码或 OAuth 刷新令牌。
- `access_token_enc`、`access_token_expires_at` 保存加密后的访问令牌和过期时间。
- `oauth_provider` 记录 OAuth 服务商，例如 `microsoft` 或 `google`。
- `sent_folder`、`drafts_folder`、`spam_folder`、`auto_saves_sent` 记录相关文件夹和服务商自动保存已发送邮件的设置。
- `sent_copy_account_id` 供中继账户使用。当 `storage_driver` 为 `imap` 时，它指定保存已发送副本和草稿的 IMAP 账户。
- `reply_account_id` 指定回复本邮箱所收邮件时使用的账户。适用于域名把来信转到本邮箱、同时通过中继账户发信的场景。删除指定的发信账户时，此字段会清空。
- `sync_interval_minutes` 仅用于 IMAP 账户。自动查信间隔可设为 1、2、5、10、15 或 30 分钟，默认 5 分钟。
- `relay_any_address` 仅用于中继账户，默认关闭。开启后，回复时可使用与该账户域名完全相同的任意地址，详见“回复”一节。
- `signature` / `signature_html` 分别保存账户的纯文本和富文本 HTML 签名，两者均为可选项，仅在 `signature_mode` 为 `per_account` 时生效。
- `incoming_label_id` 指定自动加到本账户所有来信上的共享标签，可留空。仅发信的中继账户没有收件箱，系统会按中继地址给接收转发邮件的 IMAP 邮箱中的对应邮件加上标签。
- `delete_after_archive` 控制服务商邮箱的可选清理功能。开启后，已归档的来信会移入服务商的垃圾箱。
- `auto_sync` 控制定时任务 Worker 是否在后台自动同步收件箱、已发送、草稿和垃圾邮件文件夹。
- `storage_driver` 可取 `provider`、`drive`、`r2` 或 `imap`。其中 `imap` 仅用于中继账户，表示将副本保存在 `sent_copy_account_id` 指定的邮箱中，无需对象存储。
- `relay_provider`、`relay_api_key_enc`、`relay_api_secret_enc`、`relay_domain`、`relay_region` 保存中继服务的相关参数。
- `drive_*` 字段用于可选的 Drive 归档。

### `messages`

此表保存中继账户的已发送副本和草稿。系统从服务商读取 IMAP 邮件，并将元数据镜像到 `imap_messages`。可选的同步任务使元数据保持最新，最近读取的正文则进入短期 D1 缓存。只有启用长期归档后，完整正文才会复制到 R2 或 Drive。

中继账户把副本存在 IMAP 邮箱时，`storage_key` 保存指向邮件的指针（`imap:<accountId>:<encodedFolder>:<uid>`）。系统从该邮箱读取正文和附件。删除邮件或草稿时，也会从该邮箱移除副本。仅删除账户不会触及这些邮件。

每行都记录实际写入该副本的存储驱动。系统用 `storageForDriver(env, account, row.storage_driver)` 读取或删除对象，写入新对象时才使用 `getStorage(env, account)`。因此，即使将账户的存储目标从 Drive 改为 R2，再改为邮箱，历史副本仍可读取和删除。当账户指向邮箱但 APPEND 失败时，系统另行写入的补救副本也能正常读取。

字段包括文件夹、JSON 格式的地址信息、主题、摘要、纯文本和 HTML 正文、大小、存储键、附件元数据、会话键和状态。

<a id="labels-and-message_labels"></a>

### `labels` 和 `message_labels`

`labels` 保存自定义标签的名称和颜色，所有账户共用同一套标签。`message_labels` 按应用内邮件 ID 保存标签的分配关系，IMAP 邮件的 ID 格式为 `i_<account>.<folder>.<uid>`，中继邮件为 `r_<uuid>`。刷新页面不会丢失 IMAP 标签。如果邮箱的 UIDVALIDITY 发生变化，由于原分配关系引用的是旧 IMAP UID，需要为受影响的邮件重新分配标签。删除标签会同时删除相关分配关系和过滤器中的引用。

### `filters`

所有账户共用 Gmail 风格的自动过滤器。每行保存匹配条件（`from_pattern`、`to_pattern`、`subject_pattern`、`has_words`、`doesnt_have`、`has_attachment`）和匹配后执行的操作。`label_ids_json` 保存要添加的标签 ID，`forward_to_json` 保存转发收件人。旧字段 `account_id` 用于兼容已有数据库结构，新行均写入空字符串。

`POST /api/filters/apply` 对已经建立镜像的邮件应用已启用的过滤器。客户端用 `cursor` 控制分页，每次请求检查收件箱中的 200 封邮件，通过 `INSERT OR IGNORE` 写入匹配的标签。仅在设置 `forward` 时转发匹配邮件，每页最多转发 25 封，通过 `forward_log` 去重。接口返回 `{processed, matched, labelled, forwarded, nextCursor}`。“设置 → 过滤器”有两个操作入口。过滤器所在行的标签按钮传入 `filterId`，仅应用该过滤器。**应用所有过滤器**不传此参数，会运行所有已启用的过滤器。只有后一个入口允许转发，而且必须勾选转发选项。

列出收件箱邮件时，以及定时任务 Worker 同步新来信时，系统也会检查已启用的过滤器。匹配邮件的标签写入 `message_labels`，当 `forward_to_json` 非空时还会转发。`to_pattern` 同时检查邮件的收件人、抄送和密送地址（To/Cc/Bcc），**以及** `imap_messages.aliases_json`。后者收集转发邮件头（`Delivered-To`、`X-Forwarded-To`、`X-Original-To`、`Envelope-To`、`Received … for`）中的地址，因此仅用于转发的域名也能匹配。同步程序在首次接收邮件时写入这些值。对于此字段引入前就已建立镜像的邮件，系统从最新邮件开始，每批回到服务器读取 40 封，通过 `aliases_checked` 跟踪进度，并在回填时应用标签。回填旧邮件不会重新触发转发。

### `contacts`

所有账户共享同一本通讯录，保存在 D1 的 `contacts` 表中，不占用 R2 或 Drive 存储。字段包括 `id`、`name`（显示名称）、`email`、`note`、`source`、`first_name`、`last_name`、`company`、`job_title`、`phone`、`address`、`website`、`birthday`、`emails_json`、`phones_json`、`created_at`。

`source` 取值为 `manual` 或 `auto`。除非 `app_settings.contact_auto_add` 设为 `0`，发送邮件时会把收件人添加到类似 Gmail 的**其他联系人**中，供下次输入时自动补全。手动编辑自动添加的联系人后，其来源会改为 `manual`。在收件人、抄送或密送栏输入新地址时，可以选择**添加到联系人**。打开回复窗口时，也会自动加入此前未知的收件人。`lower(email)` 上的唯一索引防止地址重复，新增已有地址时会更新姓名和备注。界面支持搜索、新增、编辑、删除、CSV 导入和导出、vCard 导入（自动识别 3.0 和 4.0）及导出（默认 3.0，可选 4.0），并在收件人、抄送和密送栏提供自动补全。批量导入接口 `POST /api/contacts/import` 每次请求最多新增或更新 1000 条名片记录。

<a id="auto-reply-vacation-responder"></a>

### 自动回复（外出回复）

`auto_reply_mode` 取 `shared` 或 `per_account`，决定从何处读取配置。共享模式从 `app_settings` 读取 `auto_reply_enabled`、`auto_reply_subject`、`auto_reply_body` 和 `auto_reply_body_html`。按账户设置时，读取 `accounts.auto_reply_enabled/subject/body/body_html`。新来信建立镜像后，由通知定时任务发送回复。`auto_reply_log` 以 `(account_id, message_id)` 为唯一键，并为发件人建立索引。每封邮件最多收到一次回复，每个发件人在 24 小时内最多收到一次。系统跳过自己的账户地址、`no-reply` / `postmaster` / `mailer-daemon` 发件人、具有自动通知类主题的邮件，以及七天前的邮件。回复带有 `Auto-Submitted: auto-replied` 和 `X-Auto-Response-Suppress: All` 邮件头，以防止循环回复。已设置 `body_html` 时使用 HTML 正文，同时提供纯文本版本。

<a id="imap_sync-and-imap_messages"></a>

### `imap_sync` 和 `imap_messages`

`imap_messages` 在 D1 中保存 IMAP 邮件元数据的镜像，包括邮件头、标志、大小、是否有附件以及会话标识。`imap_sync` 为每个账户的每个文件夹分别保存同步游标（`uid_validity`、`max_uid`、`min_uid`、`backfill_done`），并记录状态、错误、计数和上次同步时间。

同步支持分批处理和断点续传。每个请求读取 40 封邮件的元数据，启用正文归档时每批为 8 封。程序从 `SELECT` 的响应中读取 `UIDNEXT`，获取 UID 大于 `max_uid` 的新邮件，再按有限的 UID 范围回填历史邮件，避免每轮都执行 `UID SEARCH ALL`。每轮也会刷新最近一批邮件的标志，把其他客户端设置的已读或未读状态同步到 D1。处于 `partial` 状态的文件夹会在短暂的重试间隔后继续分批回填，新邮件仍按独立的 60 秒间隔刷新。`imap_sync_locks` 中的锁记录包含所有者令牌，5 分钟后到期，可防止两个 Workers 隔离实例同时同步同一文件夹。持锁实例在长时间操作中会续期，也只有它能主动释放锁。定时 Worker 会清除过期锁。缺少锁表或所有者字段时，同步仍会以无锁方式运行。`UIDVALIDITY` 发生变化时，程序会重建该文件夹的镜像。`stable_key` 采用 RFC 定义的 `Message-ID`，缺失时使用确定性哈希值，因此邮件跨文件夹移动时可以转移其标签。历史邮件回填完成后，如果服务商和 D1 的邮件数不一致，程序会清理服务端已删除或彻底移除的邮件记录。默认也会删除相应的归档对象，已启用服务商邮箱清理时则保留归档。

文件夹中的邮件列表优先读取 `imap_messages`。打开文件夹时，若镜像已过期，服务端会立即返回缓存列表并安排后台同步。前端以逐步延长的间隔轮询轻量的同步状态，仅当出现新 UID 或文件夹状态改变时刷新列表。首次打开账户时镜像为空，服务端会先同步一批邮件，再读取镜像，无需为显示同一个文件夹建立第二条 IMAP 连接。程序只解析一次已发送、草稿和垃圾邮件文件夹的名称，分别保存到 `accounts.sent_folder`、`accounts.drafts_folder` 和 `accounts.spam_folder`。

`imap_body_cache` 为近期浏览过列表或打开过的邮件缓存正文，减少重复的 IMAP 读取。单封正文最多 512 KB，最多保留 3 天，缓存总容量上限为 64 MB。定时 Worker 会删除过期记录，并从最旧的正文开始清理，直至总量降至上限以内。每写入 50 次也会尝试清理。需要持久读取的正文仍以服务商邮箱或长期归档为准。

`accounts.auto_sync` 允许定时 Worker 自动同步该账户的收件箱、已发送、草稿和垃圾邮件。`accounts.sync_interval_minutes` 可设为 1、2、5、10、15 或 30 分钟，默认为 5 分钟。Worker 每分钟唤醒一次，距上次同步尚未达到设定间隔的账户会跳过，因此实际检查频率遵循各账户的设置。每轮按文件夹各处理一批，下轮继续。通知、转发和清理任务在每次唤醒时都会运行。新建 IMAP 账户默认启用自动同步；已有账户也可继续使用打开文件夹时触发的同步。

**元数据保留期限。** `app_settings.metadata_retention_days` 的默认值为 `0`，表示永久保留，可在「设置 → 外观」调整。设置期限后，定时 Worker 会清理 `imap_messages` 中超期的非草稿记录及相应的 `message_labels` 记录，每批 500 条，每轮最多 5,000 条。清理仅涉及本地元数据，服务商邮箱中的邮件和 R2/Drive 归档副本均保留。清理后的邮件会从文件夹列表、搜索结果和标签视图中消失。增量同步依据 `max_uid` 和 `min_uid` 处理新增或待回填的范围，无法自动找回这些记录。通过邮件 ID 直接访问仍可阅读（例如之前已打开的链接），因为镜像查无此记录时会回退到 IMAP。缩短保留期限后再延长，也无法恢复已清理的记录。

每次清理的结果都会写入 `app_settings.retention_stats`（`lastRunAt`、`lastDeleted`、`deletedTotal`、`cutoff`），可通过 `GET /api/retention` 读取，也会显示在「设置 → 外观」。调用 `POST /api/retention` 可清空 IMAP 账户的 `imap_sync` 游标。传入可选的 `{ accountId }` 时，仅重置指定账户，并将收件箱、已发送、草稿及垃圾邮件加入同步队列。重置所有账户时，为控制 Worker 的后台资源用量，仅将收件箱加入队列，其他文件夹在打开或自动同步时跟进。后续各轮会重新扫描邮箱，更新镜像中已有的记录并重新建立此前清理的记录。原有标签关联已随清理删除，重新扫描无法恢复。全量扫描在每轮同步中按文件夹各处理一批元数据。

可通过 `accounts.archive_imap_bodies` 启用正文归档。`accounts.imap_archive_driver` 为**新归档**选择 `r2` 或 `drive`。每条已归档记录同时保存 `imap_messages.archive_driver` 和 `archive_key`。两条同步路径共用 `ARCHIVE_UPDATE_SQL` 更新这些字段，防止遗漏。读取或清理归档正文时，`archiveStorageCandidates` 首先尝试记录中指定的后端，再尝试另一个已配置的后端。因此在 R2 与 Drive 之间切换后仍能读取早期归档。启用 `delete_after_archive` 时尤为重要，因为此时服务商的邮件副本已移入回收站。字段引入前创建的归档记录保留 `archive_driver = NULL`，读取时会依次尝试两个后端。R2 需要绑定 `BUCKET`，Drive 需要该账户已通过 OAuth 连接 Google 云端硬盘。同步程序将原始 EML 文件存入 `imap/<account>/<folder>/<uidvalidity>/<folder>-<uid>.eml`，并在 `imap_messages` 中写入 `archived`、`archive_key` 和 `archive_driver`。使用 Drive 时，`archive_key` 为 Drive 文件 ID。阅读邮件与附件读取、下载接口依次尝试 D1 正文缓存、归档和 IMAP。关闭归档时，正文和附件保存在服务商邮箱中。

<a id="push_subscriptions-and-push_prefs"></a>

### `push_subscriptions` 和 `push_prefs`

`push_subscriptions` 保存 Web Push 端点及其 `p256dh` 和 `auth` 密钥，订阅对整个部署实例生效。`push_prefs` 按账户保存通知设置，包括 `enabled` 和 `folders_json`（默认为 `["inbox"]`）。定时任务端点读取这两张表，同步所选文件夹，并为 UID 大于先前 `max_uid` 的邮件发送通知。

<a id="forward_log-and-deletion_log"></a>

### `forward_log` 和 `deletion_log`

`forward_log` 按 `(filter_id, message_id)` 记录最近一次转发的结果，避免重复转发。`deletion_log` 逐封记录服务商邮箱的清理结果。

转发是过滤器支持的一项操作。定时任务端点用过滤器检查新收到的邮件，应用相应标签，并将命中的邮件转发给过滤器指定的收件人。转发邮件附带原始 EML 文件，并添加 `X-WhelkMail-Forwarded` 邮件头以防止循环转发。

同时启用 `archive_imap_bodies` 和 `delete_after_archive`，且邮件已完成归档时，程序才会清理服务商邮箱。邮件先被复制到服务商的回收站，再从原文件夹移除。归档副本会保留。

### `app_settings`

此键值表保存整个部署实例的设置，包括签名（`default_signature`、`default_signature_html`、`signature_mode`）、自动回复（`auto_reply_mode`、`auto_reply_enabled`、`auto_reply_subject`、`auto_reply_body`、`auto_reply_body_html`）、远程图片（`allow_remote_images`）、保留策略（`metadata_retention_days`、`retention_stats`）、双因素认证所需的数据和版本检查状态（`update_check` 缓存、`update_notice_dismissed`）。

`signature_mode` 可取 `shared`（默认）或 `per_account`。

- `shared` 模式下，所有账户都使用 `default_signature` 和 `default_signature_html`，忽略 `accounts.signature`。
- `per_account` 模式下，各账户使用自己的 `accounts.signature` 和 `accounts.signature_html`。值为空表示不添加签名。

<a id="6-security-model"></a>

## 6. 安全模型

- **共享密码与可选双因素认证。** 整套部署共用 `APP_PASSWORD`。双因素认证默认关闭，可在「设置 → 安全」中启用。它采用 TOTP（RFC 6238），可搭配支持 TOTP 的身份验证器使用。恢复码只显示一次，数据库仅保存其 SHA-256 哈希值。
- **会话。** 会话 ID 为随机生成的 256 位值，D1 的 `sessions` 表仅保存其 SHA-256 哈希值，会话有效期为 7 天。Cookie 带有 `HttpOnly`、`SameSite=Lax` 属性，HTTPS 下还会设置 `Secure`。退出登录会撤销当前会话；删除 `sessions` 表的全部记录会使所有会话失效。
- **防止暴力尝试。** D1 按 IP 限制登录和双因素认证的尝试次数，每 15 分钟最多 10 次，达到限制后封锁 15 分钟。
- **来源检查。** 对于会修改数据的请求，服务端会拒绝携带其他来源 `Origin` 请求头的请求。
- **OAuth。** 一次性 `state` 值保存在 D1，有效期为 10 分钟。Google、Microsoft 和 Google Drive 的授权流程均使用 PKCE（`S256`）。
- **凭据加密。** 使用 `TOKEN_ENC_KEY`（32 字节的原始密钥，以 Base64 编码）通过 AES-256-GCM 加密 IMAP/SMTP 密码、OAuth 刷新令牌和中继服务 API 密钥。会话与认证挑战的签名使用 HKDF 派生的子密钥。
- **安全响应头。** 静态资源通过 `public/_headers`、API 响应通过中间件设置 CSP、HSTS、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` 和 `Cross-Origin-Opener-Policy`。
- **密钥轮换。** 更换 `TOKEN_ENC_KEY` 会导致所有已存凭据无法解密，并使会话和待处理的 OAuth 状态失效。用户需要重新输入密码，并重新授权 OAuth 账户。
- **使用范围。** 此应用适用于个人或相互信任的小团队，用户之间共享同一部署中的数据。可在应用前接入 Cloudflare Access，加强身份验证。
- **机密配置。** Git 已忽略 `.dev.vars`、`.env` 和 `.wrangler`。使用 Pages 部署时，应在 Pages 项目设置中保存生产环境密钥。

如果身份验证器和恢复码都已遗失，可在 D1 控制台执行以下 SQL 关闭双因素认证并撤销所有会话。

```sql
DELETE FROM app_settings WHERE key IN ('totp_enabled', 'totp_secret_enc', 'totp_recovery_json');
DELETE FROM sessions;
```

<a id="7-authentication-per-account"></a>

## 7. 各类账户的身份验证方式

| 服务商或账户类型 | 验证方式 |
|---|---|
| Google 账户 | OAuth2（推荐），或在开启两步验证后使用应用专用密码 |
| Outlook / Microsoft 365 | OAuth2 配合 XOAUTH2；Microsoft 已停止支持基本身份验证 |
| Yahoo | 应用专用密码 |
| iCloud | App 专用密码 |
| 通用 IMAP | 账户密码或应用专用密码 |
| 中继账户 | 服务商的 HTTP API 密钥；部分服务还要求填写配套的密钥或域名 |

<a id="8-relay-accounts-and-storage"></a>

## 8. 中继账户与存储

只需通过自有域名发信时，可添加中继账户。支持的 HTTP 中继服务包括：

`smtp2go`、`resend`、`mailgun`、`brevo`、`sendgrid`、`mailjet`、`postmark`。

- 可以在界面中分别为每个账户输入凭据，应用会加密保存。
- 若账户未单独提供凭据，应用会尝试使用部署级的 `RELAY_*` 变量。
- 发件域名必须先在服务商处完成验证（SPF/DKIM）。
- 应用针对各服务商设置了保守的附件大小上限：多数为 15 MB，Mailjet 为 12 MB，Brevo 为 8 MB。

归档存储有以下选择：

- **Google Drive。** 用户通过 OAuth 授予 `drive.file` 权限，文件保存在 `MailClient` 文件夹中。个人账户有 15 GB 免费空间。服务账号没有存储配额，无法用作免费的存储桶。
- **Cloudflare R2。** 可选绑定名为 `BUCKET`。未配置绑定时，界面会隐藏 R2 选项。

IMAP 账户默认将附件、已发送邮件副本和草稿保存在邮件服务商处。要使用外部存储，请在对应账户的同步设置中开启「归档正文和附件」，归档位置同样可以选择 Drive 或 R2。

<a id="9-account-chips-and-custom-labels"></a>

## 9. 账户标识与自定义标签

每封邮件都带有 `accountId`、`accountName` 和 `accountEmail`。统一视图为每个已连接的地址分配固定颜色，账户栏可以按地址筛选。这里的颜色对应已连接的账户地址，同一账户下的不同别名共享这一标识。

自定义标签由用户创建，各账户共享。可在侧边栏或筛选规则编辑器中创建标签。点击标签会进入其邮件视图：API 读取 `message_labels`，将打过标签的邮件 ID 按账户和文件夹分组，再根据 UID 直接向 IMAP 服务商获取邮件，并与中继账户的邮件合并。这个视图类似 Gmail，可显示选定账户的收件箱、已发送、草稿箱和垃圾邮件，无需在本地镜像整个邮箱。已移除或已彻底清除的邮件会从视图中消失。

每个账户还可设置 `incoming_label_id`。列出收件箱时，应用会自动给该账户的每封来信加上指定的共享标签。添加账户时或在设置中都可选择此标签，标签尚不存在时会自动创建。仅发信的中继账户本身没有收件箱。它的来信标签按中继地址匹配，应用到接收转发的 IMAP 邮箱中原本发给该别名的邮件上。

在「设置 → 筛选规则」中管理自动筛选，各账户共享规则。同一条规则中的所有条件须同时满足，匹配时忽略大小写。和 Gmail 类似，一条规则可以添加一个或多个标签、将邮件转发给指定收件人，也可同时执行这两种操作。列出收件箱和定时 Worker 同步新邮件时都会执行匹配。文本匹配范围包括发件人、收件人、主题和摘要，不搜索完整正文。如果一封邮件只同步了邮件头，正文索引完成后会重新匹配，避免 `has_words` 或 `doesnt_have` 依据空摘要作出判断。

邮件在服务商处移动到其他文件夹后，UID 会改变，原有本地标签关联随之失效。可选的 IMAP 元数据同步会镜像邮件头和 UID。由于标签按 UID 关联，移动后可能需要重新为邮件打标签。

<a id="10-pwa-and-web-push"></a>

## 10. PWA 与网页推送

`public/manifest.webmanifest` 和 `public/sw.js` 让用户可以安装应用。Service Worker 缓存应用外壳和静态资源，跳过 `/api/`，并处理 `push`、`notificationclick` 和 `pushsubscriptionchange` 事件。

网页推送分为三个步骤：

1. 客户端请求浏览器通知权限，注册 Service Worker，使用 VAPID 公钥创建推送订阅。
2. `push_subscriptions` 和 `push_prefs` 分别保存订阅以及按账户和文件夹设置的偏好。
3. `worker/` 下的定时 Worker 每分钟运行一次，使用 `CRON_SECRET` 调用 `POST /api/cron/notifications`。该接口同步选中的文件夹，根据 UID 识别新邮件，再使用 VAPID 发送加密的网页推送消息。

应用会自动维护订阅。浏览器轮换订阅或将其标为失效时，`pushsubscriptionchange` 处理程序会重新订阅并登记新的端点。每次启动和登录后，应用也会重新登记当前订阅，以覆盖未触发该事件、站点数据已清除或会话已过期的情况。定时 Worker 还会移除返回 404/410 的失效端点。新邮件通知使用 `Urgency: high`（RFC 8030），避免 Chrome 和 FCM 在设备进入 Doze 省电模式时推迟投递。

运行 `npm run vapid` 生成 VAPID 密钥，并存入 Pages 的机密变量。定时 Worker 需要设置 `APP_URL` 和与主应用一致的 `CRON_SECRET`。

<a id="release-check"></a>

### 版本检查

`GET /api/update` 将 `APP_VERSION`（定义在 `shared/version.ts`，同时记录在 `package.json`）与 `WhelkMail/WhelkMail` 的最新发布版本比较。查询由 Worker 向 GitHub 发起，超时时间为 8 秒，访客的 IP 和邮箱数据不会发往 GitHub。设置 `UPDATE_CHECK=off` 可关闭检查；可选的 `GITHUB_TOKEN` 可提高请求配额。应用先请求 API 的 `/releases/latest`，失败时改读版本发布 Atom 订阅源。一个常见的失败原因是 Cloudflare 出口 IP 共享的未认证请求配额耗尽。结果缓存于 `app_settings.update_check`，常规有效期为 24 小时，因此正常情况下每套部署每天最多查询一次。查询失败或尚无发布版本时，缓存仅保留 15 分钟。即使 GitHub 暂时无法访问，已有缓存仍可提供结果。手动调用 `GET /api/update?refresh=1`（「设置 → 系统 → 重新检查」）可跳过缓存，Worker 会记录查询失败日志。

如有新版本，客户端会在横幅中显示升级步骤和 `docs/UPGRADE.md` 链接。关闭横幅后，`POST /api/update` 会在服务端按版本保存 `update_notice_dismissed`。由于 `GET /api/health` 也返回 `version`，保持打开的旧版标签页如果发现服务器已升级，可以提示用户重新加载。

版本检查仅用于提示，升级仍需自行执行。在引入此功能之前安装的旧版没有相关代码，只能通过版本发布说明了解更新。

<a id="11-forwarding-and-provider-cleanup"></a>

## 11. 邮件转发与服务端清理

转发是筛选规则的一项操作。与 Gmail 类似，规则可以添加标签、转发给一个或多个收件人，或同时执行两者。定时任务接口处理 UID 大于收件箱上次 `max_uid` 的邮件，应用已启用的筛选规则和账户来信标签。当邮件匹配带有 `forward_to_json` 的规则时，应用会基于原始 EML 创建转发邮件，以 `message/rfc822` 附上原件，并添加 `X-WhelkMail-Forwarded` 邮件头。已带此头的邮件会被跳过，以避免循环转发。`forward_log` 的唯一键 `(filter_id, message_id)` 确保每封邮件在同一规则下只转发一次。

服务端清理须按账户手动启用，并先开启正文归档。对于已设为 `archived = 1` 且含有 `archive_key` 的收件箱新邮件，定时任务会将邮件复制到服务商的废纸篓（优先识别 `\Trash` 标记，也支持按文件夹名称查找），从收件箱中移除，并写入 `deletion_log`。启用清理后，保存在 R2 或 Drive 的归档对象仍会保留。

<a id="12-internationalization"></a>

## 12. 国际化

- 默认界面语言为简体中文，同时支持英语和意大利语。
- 用户的选择保存在 `localStorage` 的 `whelkmail_locale` 键中，并兼容旧版 `mc_locale` 键。
- 界面翻译在 `src/i18n.tsx` 和 `src/locales/` 中维护。添加语言时，请补充相应字典并在 `LOCALES` 中注册。
- 应用可根据错误码显示已翻译的提示，外部邮件服务返回的原始诊断信息会保留原文。

<a id="13-local-development"></a>

## 13. 本地开发

```bash
npm install
npm run db:init:local
npm run dev
npm run dev:api
```

- `npm run db:init:local` 在本地 D1 数据库中执行 `db/schema.sql`，并将当前迁移标记为后续升级的基线。
- `npm run db:migrate:local` 将所有增量迁移应用到已有的本地数据库，涵盖标签、过滤器、联系人、同步、归档、推送、转发、删除和安全功能。
- 如果只需要会话、双因素认证限流和 OAuth 状态等安全相关的表，运行 `node scripts/migrate.mjs local --from=012`。现有会话将失效，需要重新登录。
- `npm run dev` 在 5173 端口启动 Vite。
- `npm run dev:api` 在 8788 端口启动 Pages Functions，并将静态文件请求转发给 Vite。
- 在浏览器中打开 `http://localhost:8788`。

在 `.dev.vars` 中填写本地配置：

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

运行以下命令生成 `TOKEN_ENC_KEY`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

运行类型检查、构建和代码检查：

```bash
npm run typecheck
npm run build
npm run lint
```

<a id="14-cloudflare-deployment-overview"></a>

## 14. Cloudflare 部署概览

[Cloudflare 部署指南](CLOUDFLARE.md) 逐步说明控制台操作、具体命令、D1 配置、资源绑定、密钥、OAuth 应用、验证方法和故障排查。

<a id="prerequisites"></a>

### 前置条件

- 拥有已启用 Workers 和 Pages 的 Cloudflare 账户。
- 已安装 Node.js 22 或更高版本。
- 已执行 `npx wrangler login` 登录。
- 仓库已推送到 GitHub，支持私有仓库。

<a id="121-create-the-d1-database"></a>

### 12.1 创建 D1 数据库

```bash
npx wrangler d1 create mail-client
```

在本地使用 CLI 时，将返回的 `database_id` 复制到 `wrangler.jsonc`。通过 Pages 控制台部署时，也可以直接在控制台配置 `DB` 绑定：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "mail-client",
    "database_id": "<your-database-id>"
  }
]
```

仓库中的 `wrangler.jsonc` 省略了 `database_id`，这样“Deploy to Cloudflare”流程和 `wrangler deploy` 都可以自动创建 D1 数据库。在本地填入实际 ID 后，请勿将其提交到版本库。

D1 数据库沿用旧名 `mail-client`，以便继续使用现有数据。Pages 项目名为 `whelkmail`。

<a id="122-create-the-pages-project"></a>

### 12.2 创建 Pages 项目

通过控制台创建：

1. 进入 **Workers & Pages → Create → Pages → Connect to Git**（连接到 Git）。
2. 选择仓库。
3. 构建命令填 `npm run build`。
4. 构建输出目录填 `dist`。
5. 根目录填 `/`。
6. 如果默认的 Node.js 版本低于 22，设置 `NODE_VERSION=22`。

也可以通过命令行创建和部署：

```bash
npx wrangler pages project create whelkmail
npm run deploy
```

`npm run deploy` 会先构建前端，再运行 `wrangler pages deploy dist`。

<a id="123-bindings"></a>

### 12.3 资源绑定

在 Pages 项目设置中打开 **Bindings**（绑定）：

- **D1**：变量名填 `DB`，选择数据库 `mail-client`。
- **R2（可选）**：变量名填 `BUCKET`，选择或创建一个存储桶。

绑定名称必须与 `DB` 和 `BUCKET` 完全一致。

<a id="124-secrets-and-variables"></a>

### 12.4 密钥与变量

在 **Pages → Settings → Variables and Secrets**（变量和密钥）中添加下列配置，凭据应使用加密的密钥类型。

必填项：

| 名称 | 类型 | 用途 |
|---|---|---|
| `APP_PASSWORD` | 密钥 | 整个应用共用的登录密码 |
| `TOKEN_ENC_KEY` | 密钥 | 经 Base64 编码的 32 字节密钥。保存凭据后请勿更换 |

可选项：

| 名称 | 类型 | 用途 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | 密钥 | 中继和 IMAP 账户在 Google 云端硬盘归档时使用的客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 密钥 | Google OAuth 客户端密钥 |
| `GOOGLE_MAIL_CLIENT_ID` | 密钥 | 使用 Google OAuth 连接 IMAP/SMTP 的客户端 ID |
| `GOOGLE_MAIL_CLIENT_SECRET` | 密钥 | 使用 Google OAuth 连接 IMAP/SMTP 的客户端密钥 |
| `MICROSOFT_CLIENT_ID` | 密钥 | Microsoft OAuth 应用 ID |
| `MICROSOFT_CLIENT_SECRET` | 密钥 | Microsoft 客户端密钥 |
| `MICROSOFT_TENANT` | 变量 | 填 `common` 或租户 ID |
| `RELAY_PROVIDER` | 变量 | 整个部署使用的默认发信中继 |
| `RELAY_API_KEY` | 密钥 | 默认中继 API 密钥 |
| `RELAY_API_SECRET` | 密钥 | Mailjet 的默认 API 密文 |
| `MAILGUN_DOMAIN` | 变量 | Mailgun 的默认域名 |
| `MAILGUN_REGION` | 变量 | 填 `us` 或 `eu` |

在界面上为单个账户填写的中继凭据优先于这里的默认值。

<a id="125-apply-the-schema"></a>

### 12.5 应用数据库架构

```bash
npm run db:init:remote
```

如果数据库表创建于引入标签和签名功能之前，运行增量迁移：

```bash
npm run db:migrate:remote
```

如果数据库表创建于支持发信中继之前，对缺少相应字段的表执行以下迁移：

```sql
ALTER TABLE accounts ADD COLUMN relay_api_key_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_api_secret_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_domain TEXT;
ALTER TABLE accounts ADD COLUMN relay_region TEXT;
```

<a id="126-workers-paid"></a>

### 12.6 Workers 付费方案

IMAP 和 SMTP 的 TLS 握手及身份验证经常超过 Workers 免费方案的 CPU 限额（10 毫秒）。需要稳定使用时，可选择 Workers Paid 方案（月费 5 美元起）。

<a id="127-google-drive-oauth-optional"></a>

### 12.7 Google 云端硬盘 OAuth（可选）

将邮件归档到 Google 云端硬盘的中继账户，以及在同步设置中开启**归档正文和附件**的 IMAP 账户，都使用此处的云端硬盘凭据。Gmail 收发邮件使用另一组凭据（`GOOGLE_MAIL_CLIENT_ID` 和 `GOOGLE_MAIL_CLIENT_SECRET`）。未配置云端硬盘凭据时，点击**连接 Google 云端硬盘**会返回 `oauth_not_configured`。

1. 在 Google Cloud 控制台启用 Google Drive API。
2. 在 OAuth 同意屏幕选择 **External**（外部）。
3. 添加权限范围 `openid`、`email` 和 `https://www.googleapis.com/auth/drive.file`。
4. 创建 OAuth 客户端 ID，应用类型选择 **Web application**（Web 应用）。
5. 添加已获授权的重定向 URI：
   - `https://<your-domain>/api/drive/oauth/callback`
   - `http://localhost:8788/api/drive/oauth/callback`（本地开发）。
6. 将客户端 ID 和密钥分别填入 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。
7. 将 OAuth 同意屏幕的发布状态设为 **In production**（正式发布）。在 Testing（测试）状态下，刷新令牌会在 7 天后过期。`drive.file` 属于非敏感权限范围，无需进行 CASA 评估。

<a id="128-google-oauth-for-imapsmtp-optional"></a>

### 12.8 用于 IMAP/SMTP 的 Google OAuth（可选）

Google 账户支持通过 OAuth2 验证 IMAP/SMTP 连接，Thunderbird 也使用这种方式。连接需要受限权限范围 `https://mail.google.com/`。

1. 在 Google Cloud 控制台创建或选择一个项目。
2. 在 OAuth 同意屏幕选择 **External**（外部）。如果只供本 Google Workspace 组织使用，可选 **Internal**（内部）。
3. 添加权限范围 `openid`、`email` 和 `https://mail.google.com/`。
4. 创建类型为 **Web application**（Web 应用）的 OAuth 客户端 ID。建议为邮件单独创建客户端，让只使用云端硬盘的配置继续仅申请非敏感权限。
5. 添加已获授权的重定向 URI：
   - `https://<your-domain>/api/google/oauth/callback`
   - `http://localhost:8788/api/google/oauth/callback`。
6. 设置 `GOOGLE_MAIL_CLIENT_ID` 和 `GOOGLE_MAIL_CLIENT_SECRET`。
7. `https://mail.google.com/` 属于受限权限范围。公开发布的生产应用需要通过 Google 验证（涉及 CASA）。个人使用时，可以将同意屏幕保持在 **Testing**（测试）状态，并将要接入的 Google 账户添加为测试用户。这样即可授权，但刷新令牌在 7 天后过期。选择内部类型的 Workspace 应用可免于验证，使用范围限于所属组织。

如果尚未配置 Google OAuth，Google 账户可启用两步验证，再使用应用专用密码连接邮箱。

<a id="129-microsoft-oauth-optional"></a>

### 12.9 Microsoft OAuth（可选）

接入 Outlook 或 Microsoft 365 时必须配置 Microsoft OAuth。这些服务已停止支持 IMAP/SMTP 基本身份验证。

1. 进入 **Microsoft Entra ID → 应用注册 → 新注册**。
2. 根据使用场景选择支持的账户类型（个人账户、组织账户或两者）。
3. 添加 Web 平台的重定向 URI：
   - `https://<your-domain>/api/microsoft/oauth/callback`
   - `http://localhost:8788/api/microsoft/oauth/callback`。
4. 在**证书和密码**中创建客户端密码。
5. 添加以下委托类型的 API 权限：
   - Office 365 Exchange Online：`IMAP.AccessAsUser.All`、`SMTP.Send`
   - OpenID 权限范围：`offline_access`、`openid`、`email`、`profile`
6. 如果租户要求管理员同意，授予管理员同意。
7. 设置 `MICROSOFT_CLIENT_ID`、`MICROSOFT_CLIENT_SECRET` 和 `MICROSOFT_TENANT`。若需同时支持个人账户和工作账户，租户填 `common`。

<a id="1210-custom-domain"></a>

### 12.10 自定义域名

进入 **Pages → Custom domains**（自定义域名），添加域名并按提示设置 DNS。变更域名后，请同步更新 OAuth 重定向 URI。

<a id="1211-post-deploy-checklist"></a>

### 12.11 部署后验证

- 确认 `GET /api/health` 返回 `ok: true`。
- 使用 `APP_PASSWORD` 登录。
- 添加一个 IMAP 账户，在设置中点击**测试连接**。
- 发送一封邮件，在邮箱服务商的“已发送”文件夹中确认副本。
- 保存一封草稿，再重新打开。
- 添加第二个账户，检查标签和统一收件箱。
- 对于中继账户，检查中继密钥、域名验证状态以及存放归档的存储位置。

<a id="15-environment-reference"></a>

## 15. 环境变量与绑定

| 名称 | 必需 | 用途 |
|---|---|---|
| `APP_PASSWORD` | 是 | 应用登录密码 |
| `TOKEN_ENC_KEY` | 是 | 使用 AES-GCM 加密已存凭据的密钥 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 否 | Google 云端硬盘归档 |
| `GOOGLE_MAIL_CLIENT_ID` / `GOOGLE_MAIL_CLIENT_SECRET` | 否 | IMAP/SMTP 使用的 Google OAuth 凭据 |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | 否 | Outlook OAuth 凭据 |
| `MICROSOFT_TENANT` | 否 | 默认值为 `common` |
| `RELAY_PROVIDER` | 否 | 备用的默认中继服务商 |
| `RELAY_API_KEY` | 否 | 备用的默认中继 API 密钥 |
| `RELAY_API_SECRET` | 否 | Mailjet 的备用密钥 |
| `MAILGUN_DOMAIN` / `MAILGUN_REGION` | 否 | Mailgun 的备用域名和区域 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 否 | 网页推送的 VAPID 密钥对 |
| `VAPID_SUBJECT` | 否 | VAPID 联系方式（`mailto:`） |
| `CRON_SECRET` | 否 | 定时任务 Worker 的共享密钥 |
| `DB`（D1 绑定） | 是 | 元数据 |
| `BUCKET`（R2 绑定） | 否 | R2 归档 |

<a id="16-troubleshooting"></a>

## 16. 故障排查

| 现象 | 可能原因与处理方法 |
|---|---|
| Google 返回 `AUTHENTICATIONFAILED` | 选择 OAuth，或启用两步验证后使用应用专用密码。直接填 Google 登录密码会导致认证失败。 |
| Google OAuth 约 7 天后失效 | 授权同意屏幕仍为测试状态。可改用组织内部应用、完成 Google 验证，或改用应用专用密码。 |
| Google 显示“访问被阻止”（access blocked） | 检查重定向 URI 是否一致、是否已添加测试用户，以及所申请的受限权限是否需要验证。 |
| Outlook 登录失败 | 检查 OAuth 权限、重定向 URI 和管理员同意状态。 |
| 连接超时 | 检查主机、端口及加密方式。常见组合有 993/TLS、465/TLS、587/STARTTLS 和 143/STARTTLS。 |
| 未保存已发送副本 | 服务商可能不支持 `\Sent`/`APPEND`。手动指定文件夹或调整 `auto_saves_sent`。 |
| 已发送邮件重复出现 | 服务商已经保存副本，但 `auto_saves_sent` 仍为 false。 |
| 无法保存草稿 | 缺少 `\Drafts` 文件夹或没有 `APPEND` 权限。 |
| Google 云端硬盘返回 403 | 检查 OAuth 权限、测试状态下的令牌是否已过期，以及云端硬盘是否已连接。 |
| 看不到 R2 选项 | 缺少 `BUCKET` 绑定。 |
| 附件被拒绝 | 邮件可能超过服务商设置的大小上限。 |
| `CPU time limit exceeded` | 可升级到 Workers Paid。 |
| 部署后 D1 报错 | 检查 `database_id` 是否仍为占位值，并确认已应用数据库结构。 |

<a id="17-known-limitations"></a>

## 17. 已知限制

- 暂不支持 IMAP IDLE。元数据可手动分批同步，也可启用定时任务 Worker 自动同步。网页推送同样依赖定时任务。
- 文件夹列表从 D1 镜像分页读取（每页最多 100 封）。首次打开账户时会从 IMAP 初始化镜像。搜索可覆盖已同步、已索引的内容，详见[搜索](#search)。
- 界面不提供针对整个远端 IMAP 邮箱的服务端搜索。
- HTML 正文在沙箱框架中显示。默认屏蔽远程图片和跟踪像素，可在“设置 → 常规”中全局允许，也可仅对当前邮件允许。小型内嵌 `cid:` 图片随详情响应返回，较大图片通过需要认证的附件接口读取。如果邮件大小在缓存范围内，附件接口会使用 D1 正文缓存。
- 对于未进入 D1 正文缓存的邮件，下载附件需要重新读取整封邮件。不超过 512 KB 的邮件首次读取后会进入缓存。较大的邮件继续从服务商读取，已配置长期归档的情况除外。
- 发件人通常为账户地址。中继账户启用“允许使用此域名下的任意地址发信”后，回复时可使用来信实际寄往的同域地址。撰写时无法任意填写发件地址。
- 回复账户和动态别名均依赖邮件头，而用于挑选地址的部分字段没有签名。仅凭 IMAP 无法完全确认投递地址。转发头仅在收件服务器添加的最上层 `Authentication-Results` 显示该域名的 DKIM 校验通过时才参与匹配。这能过滤直接投递邮件中的伪造转发头，但仍有边界：自建服务器若不添加认证结果，可能误读来信自带的同名字段；合法签名邮件被再次投递时，其未签名的转发元数据也可能无法验证。Gmail、Outlook 和 Fastmail 等托管服务都会添加自己的认证结果。选择范围始终限于中继自身的域名，发送前可在发件人栏核对。若要进一步核验来源，还需维护可信转发服务器列表。
- 自动保存要求服务商允许向草稿文件夹执行 `APPEND`。如果服务器不返回 `APPENDUID`，程序会通过搜索定位新 UID。多个客户端并发保存时，搜索结果可能不唯一。
- 转发和服务商邮箱清理仅处理首次同步后由定时任务发现的新邮件。失败的操作会记入日志，当前不会自动重试。
- 服务商邮箱清理要求先归档，再将原件移入垃圾箱；清理功能不会在服务商端永久删除邮件。
- 删除一个承载中继副本的账户（由 `sent_copy_account_id` 指定）时，接口返回 `409 account_used_as_copy_target` 以及受影响的中继账户列表。界面会要求再次确认，再使用 `?force=1` 重试。副本仍在服务商端，但应用将无法再访问它们的附件和 `.eml`。账户删除操作会清除 D1 记录，并按存储驱动分组删除 D1 引用的 R2/Drive 对象（`planAccountPurge`）。账户及其 Drive 令牌一旦删除，失败的对象清理便无法重试。因此会将对象键、存储后端和错误写入 `storage_cleanup_log`，每次删除最多记录 50 项，可在“设置 → 系统 → 遗留对象”中查看。账户删除不会删除服务商端的邮件。写入失败产生的孤立对象可能残留。
- 暂无按用户隔离或审计日志。登录和双因素认证的请求限流仅按 IP 执行。
- 通用 API 错误含有稳定的 `code`，界面根据它显示对应语言的提示。IMAP 或中继服务商返回的具体诊断信息仅提供给已登录的管理员，公开接口不返回这些详情。
- 列表中的附件标记来自 `BODYSTRUCTURE`。最新邮件的正文会在后台预取并缓存；其他邮件在打开时才下载。
- 中继账户需要可用的副本存储目标（Drive、R2 或 IMAP 邮箱）。如果发送前检查发现没有可用目标，系统**在调用中继前**中止发送并返回 `storage_failed`。中继已接收邮件之后才发生的 IMAP 副本写入错误，处理方式见[发送邮件](#send)。
- 在 Workers 上，自定义 SMTP 中继连接 `smtp.gmail.com`（465、587）及 `smtp.mail.yahoo.com:465` 时曾在身份认证前报 `Network connection lost.`。其他主机如 `smtp.fastmail.com:465` 可正常建立连接。可改用 HTTP 中继或接受该连接的 SMTP 服务器。
- 只有中继明确拒绝请求（4xx，或带错误响应体的 2xx），发送记录才标为 `failed`。5xx、超时或断线时记录为 `unknown`，因为服务商可能已经接收邮件。界面会提示先检查服务商的活动日志，避免重复投递。
- Cloudflare Email Service 中继为实验功能。实现依据 Cloudflare 的 REST API 文档，上游维护者尚未用实际账户验证投递、抑制名单处理（错误码 `10205`）、限流及逐收件人报告。有可靠投递要求时请选用经实际验证的中继。

<a id="18-license"></a>

## 18. 许可证

本项目采用 MIT 许可证，完整条款见 [LICENSE](../LICENSE)。
