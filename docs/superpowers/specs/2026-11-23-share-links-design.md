# 分享链接（只读下载页）开发文档

- 日期：2026-11-23 ｜ 状态：**v2 简化版（2026-11-24 用户批准：移除下载次数上限、移除 PATCH 改期端点）** ｜ 上游：无
- 目标读者：实施工程师。本文档即契约：分层、字段、路由、错误语义照此实现，不得自行增删端点。

## 1. 功能介绍与实现逻辑

### 1.1 功能
用户对自己的**单个文件**创建一条公开分享链接。任何人（无需登录）打开链接看到只读下载页：文件名、大小、（如有）密码输入框、下载按钮。链接支持：可选访问密码、可选有效期、随时撤销。~~下载次数上限~~（v2 移除，留作后续）。

**是什么**：内容只读快照。文件改名不影响已发链接（展示用名存在 share 行里，见 §2）；文件被移入回收站 → 链接立即失效；永久删除 → 链接失效（且见 §5.4 级联）。
**交付边界（builder-check 裁定）**：后端全量 + **React 访客下载页最小实现**——公开路由 `/d/:token`（加入 guard 白名单免登录），展示文件名/大小/密码框/下载按钮，无样式打磨要求。owner 侧"我的分享"管理页为非目标（后端 API 已齐，UI 另立）。
**不是什么**：不做文件夹分享、不做上传协作、不做在线预览、不做 owner 分享管理页。

### 1.2 实现逻辑（一次访问的生命周期）
```
创建：owner(JWT) POST /files/:id/shares → 校验归属+active → 生成 token(crypto/rand 32B→base64url 无填充43字符)
      → 密码 bcrypt(cost 10) 哈希入库 → 返回 {token,url}
访问：访客 GET /public/shares/:token → 查 share → 判定 revoked/过期/文件状态 → 元信息(含 needs_password)
验证：有密码则 POST /public/shares/:token/verify → bcrypt 比对 → 签发 share-access JWT(15min,scope=share)
下载：GET /public/shares/:token/download（带 share-access JWT，无密码链接则公开）
      → 校验 → download_count 原子自增（纯统计，不设闸） → 从 MinIO 流式回传
```
匿名端点全部挂 Redis 限流（§6）。token 不做任何可预测性妥协：库表按 token 唯一索引查，泄露面=知道 token 的人。

## 2. 数据模型

### 2.1 新表 `share_links`（migration `000006_create_share_links.up.sql`）
| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGINT UNSIGNED PK AI | |
| token | CHAR(43) UNIQUE NOT NULL | url-safe base64，无填充 |
| owner_id | BIGINT UNSIGNED NOT NULL | 冗余归属，列表查询免 join files |
| file_id | BIGINT UNSIGNED NOT NULL | 指向 files.id |
| display_name | VARCHAR(255) NOT NULL | 创建时冻结的文件名（快照语义） |
| password_hash | VARCHAR(60) NULL | bcrypt；NULL=无密码 |
| expires_at | DATETIME NULL | NULL=永久；创建时由请求 `expires_in`(秒) 折算 |
| download_count | INT NOT NULL DEFAULT 0 | 纯统计（v2：无 download_limit 列） |
| revoked_at | DATETIME NULL | 软撤销 |
| created_at / updated_at | DATETIME | |
索引：`uk_token(token)`、`idx_owner(owner_id, created_at)`、`idx_file(file_id)`。

### 2.2 share-access JWT（不落表）
复用 `internal/auth` TokenManager 加一个**独立 scope**：`IssueShareToken(shareID uint64)` / `ParseShareToken`，claims 含 `scope:"share"`、`sub:string(shareID)`，TTL 15 分钟。与登录 token 同密钥不同 scope，**互不通用**（Parse 双向校验 scope 拒绝）。
**存量兼容（builder-check 裁定）**：现网 access token 无 scope 字段——`ParseAccessToken` 对 **scope 缺失按 "user" 处理**（避免部署瞬间全员 401 强制重登）；新签发的登录 token 显式带 `scope:"user"`。share 端点仅认 `scope=="share"`，user 端点仅认 `user|缺失`。auth 包测试须覆盖双向拒绝 + 缺失兼容三条。

## 3. 控制层（`internal/httpapi`，新文件 `share_handler.go`；路由加进 `router.go`）

```
api.POST  /files/:id/shares            authed   Create        201 ShareResponse / 400 409（409=数量超限）
api.GET   /shares                      authed   ListMine      200 {items:[ShareResponse]}
api.DELETE /shares/:token              authed   Revoke        204 幂等 / 404（v2：无 PATCH，改期=删了重建）
public := api.Group("/public/shares")  —— 无 RequireAuth，套 RequireShareRateLimit ——
public.GET  /:token                    公开     Meta          200 ShareMeta / 404 / 410
public.POST /:token/verify             公开     Verify        200 {share_token} / 401 429 / 404 410
public.GET  /:token/download           条件     Download      流式 / 401(需密码未验证) 404 410 429 5xx
```
- `ShareResponse`(owner 视角)：token、canonical_url(`/api/v1/public/shares/{token}`)、display_name、expires_at、download_count、revoked、created_at、has_password。**不回 password_hash。**
- `ShareMeta`(访客视角)：display_name、size、content_type、needs_password、expires_at。
- Create 请求体：`{password?: string(1..64), expires_in?: int64(>0)}`。
- 错误映射（纯函数 `statusForShareError`，模式照抄 knowledge handler）。**状态码矩阵（v2）**：

| 场景 | 访客端点 (public/*) | owner 端点 (authed) |
|---|---|---|
| token 不存在/格式非法/非本人 share | 404 `{"error":"not_found"}` | 404（不存在与非本人**不区分**） |
| 已撤销 | 410 `{"error":"share_unavailable","reason":"revoked"}` | DELETE 幂等 204 |
| 已过期 | 410 reason=`expired` | — |
| 文件入回收站 | 410 reason=`file_unavailable` | — |
| 需要密码但未验证 / 密码错 | 401 `password_required` / `invalid_password` | — |
| 触发限流 | 429 | — |

  reason 对访客可见是安全的：持有 token 本身即凭证，无枚举面。`statusForShareError` 表：`ErrShareNotFound→404`；`*ErrShareGone{Reason}→410`（Reason 是结构化字段：revoked/expired/file_unavailable）；`ErrPassword→401`；default→500。

## 4. 逻辑层（新包 `internal/share`，对齐 file/folder 包结构）

```go
type Service struct { shares Repository; files FileLookup; tokens *auth.TokenManager }
type FileLookup interface { GetActiveFile(ctx, ownerID, fileID uint64) (*file.File, error) } // file.Service 补一个方法
Create(ctx, ownerID, fileID, opts) (*Share, error)     // opts={Password,ExpiresIn}；归属+active 校验 → rand token(重试撞库≤3) → bcrypt → 限每 owner 活跃≤50、每文件≤20（超→ErrTooManyShares→409）
Meta(ctx, token) (*Share, *file.File, error)           // token 查 → 过期/撤销/文件 active 判定 → 不可用回 *ErrShareGone{Reason}
Verify(ctx, token, password) (shareJWT, error)         // bcrypt.Compare；无密码链接→ErrNoPassword（400 面）
IssueAccess / ParseAccess                              // 委托 TokenManager share scope
IncrementDownload(ctx, shareID) error                  // v2：纯统计自增，失败仅日志不拦下载
```

## 5. 数据操控层（`internal/share` 内 `repository.go` + `gorm_repository.go`）

```go
type Repository interface {
    Create(ctx, *Share) error
    GetByToken(ctx, token string) (*Share, error)          // 含 join 判定所需 file status 由逻辑层再查
    ListByOwner(ctx, ownerID) ([]Share, error)             // 含 revoked，按 created_at desc
    CountActiveByFile(ctx, fileID) (int, error);  CountActiveByOwner(ctx, ownerID) (int, error)
    Revoke(ctx, ownerID, shareID) error
    IncrementDownload(ctx, shareID) error                  // UPDATE ... SET download_count=download_count+1 WHERE id=? （v2：无 limit 条件）
    PurgeByFileTx(tx, fileID)                              // 见 5.4
}
```
- 5.2 token 生成：`crypto/rand` 32B → `base64.RawURLEncoding`；DB 唯一索引兜底。
- 5.3 无跨表事务需求（读文件状态在逻辑层两步查，接受竞态：查后瞬间移回收站 → 下载时 Consume 前文件复查兜底，仍漏只算微小窗口，记录在案）。
- 5.4 **级联**：`file.Service.HardDelete` 事务内顺带 `DELETE FROM share_links WHERE file_id=?`（对象物理删了链接必死，清掉防悬挂）；软删（进回收站）不级联——Meta/Download 的 active 判定已让链接即时失效，恢复后链接自动复活（快照语义推定，写进验收）。

## 6. 中间件与依赖
- **MySQL**：新表 migration + GORM（沿用 `internal/database`）。
- **Redis**：新增 `shareLimiter`（仿 `auth/redis_login_limiter.go` 独立文件 `internal/share/limiter.go`）：`verify` 按 IP+token 5 次/10min 防爆破；`meta/download` 按 IP 60 次/10min 防扫库。
  - **限流键必须是真实客户端 IP（builder-check 抓出的生产 bug）**：`router.SetTrustedProxies(["127.0.0.1"])`（nginx 同机反代）+ 限流取 `c.ClientIP()`。不修的后果：生产所有访客塌缩进同一桶 → 全站分享 60 次/10min 自我 DoS。**顺带把登录限流同源改掉**（同类隐患，一行改动 + 其测试更新）。
  - **Redis 故障策略（裁定）**：`meta/download` 的限流读取失败 → **fail-open 放行 + `slog.Warn`**（公开只读路径不被 Redis 故障拖死）；`verify`（密码爆破面）→ **fail-closed 503**（防爆破闸不许失效）。登录限流维持现状 fail-closed 不动。
- **MinIO**：经 `file.Service`→`storage.ObjectStorage` 流式读，无新接口。
- **JWT**：TokenManager 扩 share scope（§2.2），无新库。
- **新依赖**：`golang.org/x/crypto/bcrypt`——go.mod 已含 x/crypto（间接），提升为直接依赖即可，成本≈零。
- gin 中间件：公开组独立限流中间件 `RequireShareRateLimit`，与 `RequireAuth` 并列不混用。

## 7. 安全清单（实施必须逐条过）
密码只存 bcrypt；HTTPS 部署前提写入 README；token 高熵不可枚举；错误码不区分"不存在/无权限"；下载响应带 `Content-Disposition: attachment`（防 XSS 存储型——公开端点永不内联渲染内容，`X-Content-Type-Options: nosniff`）；日志禁打 token 全文（前 8 字符）。

## 8. 测试与验收
- 单测：`share/service_test.go`（fake repo/FileLookup：创建校验矩阵、过期/撤销判定、verify 成功失败）；`gorm_repository` 的 `TryIncrementDownload` 并发用 sqlite 或 skip-integration 标注（对齐仓库现状：repo 层无单测先例则允许 e2e 覆盖）。
- handler 表驱动：`statusForShareError` 全映射 + verify 429/401/404。（v2 注：方法名统一 `IncrementDownload`，v1 的 TryIncrementDownload 命名已废）
- JWT scope 互斥双向测试（登录 token 打 share 端点 401，反之亦然）。
- 真机冒烟（PowerShell）：登录→分享带密码→访客 meta→错密 5 次→第 6 次 429→对密→下载 200（download_count+1）→撤销→meta 410 reason=revoked；**验收矩阵照 §3 v2 状态码表逐格打勾**。

## 9. 部署与迁移 runbook（builder-check 裁定新增）
- migration 文件命名沿用 golang-migrate 格式，但**现仓库实际加载方式只有 MySQL 容器 initdb**。生产库（8.148.23.240，已有数据）执行方式：`docker exec -i <mysql-container> mysql -ugovault -p<pwd> govault < migrations/000006_create_share_links.up.sql`（`<mysql-container>` 以 `docker ps --format '{{.Names}}' | grep -i mysql` 实测为准：dev=`govault-mysql`（手工 run 的开发容器）/ prod=`agentcloudstorage-mysql-1`（compose 项目名 `agentcloudstorage`，无 container_name 覆盖），不要照抄字面量），随后 `SHOW TABLES LIKE 'share_links'` + `DESCRIBE` 验证。此 runbook 写入 `deploy/README`（新建，含"每次新 migration 的手动应用规程"），**这是全仓库第一次把 migration 应用流程成文**——秒传线的 000007/000008 直接复用。
- 应用顺序硬规则：先 migration 后代码（新列/新表均可空/增量，旧代码向前兼容）。
