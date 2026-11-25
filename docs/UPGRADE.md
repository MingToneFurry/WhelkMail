<a id="upgrading-whelkmail"></a>

# 升级 WhelkMail

WhelkMail 由你自行托管，升级时间由你决定。应用发现新版时，会在更新提示中提供本指南的链接。

<a id="before-you-start"></a>

## 升级前的准备

- 打开 **设置 → 系统 → 版本与更新**，可查看当前安装的版本和最近一次查到的发行版本。
- 应用会将当前构建与 [WhelkMail 上游的最新发行版](https://github.com/WhelkMail/WhelkMail/releases)进行比较，发现更高版本时显示提示。Worker 发起检查后会将结果缓存一天。若要关闭检查，可设置 `UPDATE_CHECK=off`。
- 阅读目标版本的发行说明，确认是否需要迁移数据库。Workers 或 Pages 部署如果需要迁移，请先迁移 D1，再部署新代码，以免请求返回数据库结构错误。Docker 在容器启动时自动迁移。

<a id="upgrading-a-deployment"></a>

## 升级现有部署

1. **获取目标版本。** 如果使用上游原版，可在 GitHub 的 fork 页面选择 **Sync fork → Update branch**，再检查 fork 的 `main` 是否对应目标发行标签。也可在命令行执行 `git fetch --tags && git checkout v1.2.3`，将示例标签替换为实际标签。如果部署的是此中文 fork，请使用包含汉化修改的分支或标签；直接检出上游标签会部署上游原版。

2. **安装依赖。** 在仓库根目录按照锁定的版本安装依赖：

   ```bash
   npm ci
   ```

3. **按发行说明迁移数据库。** 使用 Workers 或 Pages 时，如需迁移远程 D1，执行：

   ```bash
   npm run db:migrate:remote      # Workers 或 Pages 使用的 D1 数据库
   ```

   迁移会在现有结构上增加表或字段，旧版应用可以在迁移期间继续运行。等迁移完成后再使用新功能。Docker 将数据存入自己的 SQLite 文件，容器启动时自动迁移。如发行说明另有要求，请按其中的步骤操作。

4. **按部署方式发布。**

   - **Workers（默认）**：`npm run deploy` 会构建并发布当前检出的版本。若最初使用 **Deploy to Cloudflare** 按钮将部署连接到仓库，推送代码会触发更新。
   - **Pages**：让 Pages 项目从关联分支重新构建，也可执行 `npm run deploy:pages` 自行上传构建产物。
   - **Docker**：保留现有数据卷，重新构建镜像并创建容器：

     ```bash
     cd deploy/docker && docker compose up -d --build
     ```

5. **刷新网页。** 仍在使用旧版资源的标签页会提示重新加载。刷新后，打开 **设置 → 系统** 核对安装版本。

<a id="if-something-goes-wrong"></a>

## 常见问题

- **应用提示数据库结构错误。** 当前代码需要更新的数据库结构。Workers 或 Pages 部署请运行 `npm run db:migrate:remote` 后重试。
- **设置 → 系统提示无法检查更新。** Worker 暂时无法访问 GitHub API 和发行版订阅源。应用仍可使用，页面会保留上次缓存的结果。点击 **重新检查** 可立即重试。设置可选的 `GITHUB_TOKEN` 密钥可提高 API 请求限额；备用订阅源允许匿名访问。
- **fork 的构建版本高于最新发行版。** 应用仅在发现比当前构建更新的发行版时显示更新提示。

完整的版本列表和各版本说明见 [WhelkMail 上游发行记录](https://github.com/WhelkMail/WhelkMail/releases)。
