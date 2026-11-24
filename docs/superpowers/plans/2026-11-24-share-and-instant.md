# 分享链接 + 秒传去重 实施计划（v2 简化版，12 任务）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付只读分享链接（密码/有效期/撤销 + React 访客下载页）与 SHA-256 内容去重秒传（objects refcount + 延迟 blob-gc）。

**Architecture:** 分享 = 新包 `internal/share` 四层 + `share_handler` 双组路由（owner JWT / public 限流）+ JWT share scope；秒传 = `internal/file` 扩 objects 表与三个 blob 事务原语 + 直传 tee 改造 + `cmd/blob-gc`。A 轨先行，B 轨在其上 rebase，两轨串行。

**Tech Stack:** Go 1.26 / Gin / GORM / MySQL 8 / Redis / MinIO(服务端 Copy) / x/crypto bcrypt / React+Vite+Vitest（仅 A 轨访客页）。

**Spec:** `docs/superpowers/specs/2026-11-23-share-links-design.md`（v2）+ `docs/superpowers/specs/2026-11-23-instant-upload-dedup-design.md`（v2）。冲突以 spec 为准。

## Global Constraints

- 新 worktree 基于最新 main；每任务一提交；测试门：Go 任务 `go build ./... && go vet ./... && go test -race ./... -count=1`；Redis 用例沿用 `TEST_REDIS_ADDR` skip 模式；涉真库测试 `//go:build integration` + e2e 冒烟兜底。
- migration 编号：000006 share_links / 000007 objects / 000008 files 加 sha256 **且 DROP INDEX uk_files_object_key**（spec §2.2）。
- v2 已砍项**禁止复活**：download_limit 列与 410/limit 分支、PATCH /shares/:token、X-Content-Sha256、秒传 React 接线（B7 移出本计划）。
- 状态码矩阵照 spec §3 v2 表逐格（ErrShareNotFound→404；*ErrShareGone{Reason: revoked|expired|file_unavailable}→410；ErrPassword→401；ErrNoPassword→400；ErrTooManyShares→409；default→500）。`Reason` 是结构体字段，禁止字符串匹配。
- JWT：share token `scope:"share"`、TTL 15min、`sub=shareID` 字符串；登录 token 新签发带 `scope:"user"`；**ParseAccessToken 对缺失 scope 视为 user（存量兼容）**；双向拒绝测试必须有。下载凭证接受 `Authorization: Bearer <shareJWT>` **或** `?access=<shareJWT>`（React 导航下载无法带头）。
- 限流键 `c.ClientIP()`；`router.SetTrustedProxies(["127.0.0.1"])`；顺带把登录限流键从 RemoteAddr 改为同源。Redis 故障：read 限流 fail-open+Warn、verify fail-closed 503。
- 秒传语义：命中文件占配额；回收站行仍算 refcount 引用；`PermanentDelete` 去重路径**事务内不触 MinIO**，物理删除唯一出口是 `cmd/blob-gc`（安全窗默认 1h，`--max-age` 覆盖）。
- 新依赖仅 bcrypt（go mod tidy 提升间接为直接）；前端只动 `web/src/routes|api|components/Share*`，vitest+build 双绿。
- 公开端点日志禁 token 全文（前 8 字符）；下载响应 `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`。

## Review Focus

1. **存量登录 token 被 scope 改造误伤**（部署瞬间全员 401）→ A2 `TestLegacyTokenWithoutScopeStillValid`。
2. **user/share token 串线**：登录 token 直接打 download 端点必须 401（否则密码形同虚设）→ A2 双向拒绝 + A5 端点测试各钉一次。
3. **Redis 故障策略反转**：read fail-open / verify fail-closed 写反或统一 → A4 fake-limiter 注入错误的分支测试。
4. **instant 探针 vs 永久删 TOCTOU**：AcquireBlob 的 INSERT IGNORE→SELECT FOR UPDATE 序列是序列化点 → B1 原语 + B5 集成/冒烟竞态用例。
5. **blob-gc 误删重建中对象**：判定必须"无 objects 行 且 age>窗"同一轮读完成 → B5 gc 决策纯函数三态测试。

---

# A 轨 · 分享链接（7 任务）

### Task A1: share 包骨架（migration + entity + repository + errors）

**Files:**
- Create: `migrations/000006_create_share_links.up.sql`（列/索引逐字 spec §2.1 v2：token CHAR(43) UNIQUE、owner_id、file_id、display_name、password_hash NULL、expires_at NULL、download_count DEFAULT 0、revoked_at NULL、时间戳；索引 uk_token/idx_owner/idx_file）
- Create: `internal/share/share.go`、`repository.go`、`gorm_repository.go`、`errors.go`

**Interfaces:**
- Produces: `share.Share`、`share.Repository{Create; GetByToken; ListByOwner; CountActiveByFile; CountActiveByOwner; Revoke; IncrementDownload; PurgeByFileTx(tx *gorm.DB, fileID uint64) error}`、sentinels `ErrShareNotFound / *ErrShareGone{Reason string} / ErrPassword / ErrNoPassword / ErrTooManyShares`（spec §3/§4 名单）。gorm 实现照 file/gorm_repository.go 风格。

- [ ] Step 1 写 SQL（对照 §2.1 表格逐列）→ Step 2 写四个 Go 文件 → Step 3 `go build ./... && go vet ./...` 绿 → Step 4 Commit `feat(share): share_links schema, entity and repository`

### Task A2: TokenManager share scope + 存量兼容

**Files:** Modify `internal/auth/token.go`；Test `internal/auth/token_test.go`（无则新建）

**Interfaces:**
- Produces: `IssueShareToken(shareID uint64) (string, error)`、`ParseShareToken(string) (uint64, error)`；`AccessTokenClaims` 增 `Scope string \`json:"scope,omitempty"\``；`IssueAccessToken` 带 `scope:"user"`；`ParseAccessToken` 接受 `""|"user"`，拒 `"share"`。

- [ ] Step 1 失败测试三个：`TestShareTokenRoundTrip`、`TestParseAccessTokenRejectsShareScope`、`TestLegacyTokenWithoutScopeStillValid`（手签无 scope token 作 fixture；jwt v5 API 先 `go doc` 核对）→ Step 2 RED → Step 3 实现 → Step 4 `go test -race ./internal/auth/` 绿 → Step 5 Commit `feat(auth): share-scope tokens with legacy user compatibility`

### Task A3: share.Service

**Files:** Create `internal/share/service.go`；Test `service_test.go`（fake Repository/FileLookup 内存实现）

**Interfaces:**
- Consumes: A1、A2。Produces: `type FileLookup interface{ GetActiveFile(ctx context.Context, ownerID, fileID uint64) (*file.File, error) }`、`CreateOptions{Password string; ExpiresIn time.Duration}`、`NewService(shares Repository, files FileLookup, tokens *auth.TokenManager) *Service`、方法 `Create/Meta/Verify/Access/Revoke/IncrementDownload`（语义与限制数字照 spec §4：owner≤50、file≤20、token 43 字符撞库重试≤3、bcrypt cost 10）。

- [ ] Step 1 失败测试：`TestCreateValidationMatrix`（非本人/不存在→ErrShareNotFound；超限→ErrTooManyShares；password>64 拒）、`TestMetaStates`（四条 Reason 各断言结构字段）、`TestVerifyPasswords`（对/错/无密码→ErrNoPassword）、`TestCreateTokenShape` → Step 2 RED → Step 3 实现 → Step 4 race 绿 → Step 5 Commit `feat(share): service layer with validation matrix`

### Task A4: 限流中间件 + ClientIP 修正

**Files:** Create `internal/share/limiter.go`（`RedisAccessLimiter.Allow(ctx, key string, max int, window time.Duration) (bool, error)`，INCR+EXPIRE NX，仿 auth limiter）、`internal/httpapi/share_rate_limit.go`（`RequireShareRateLimit(limiter, kind string)`：kind=verify→键 ip+token 5/10min **fail-closed 503**；kind=read→键 ip 60/10min **fail-open+Warn**；超限 429）；Modify `router.go`（SetTrustedProxies）、`auth_handler.go`（登录限流键改 c.ClientIP()）；Tests `limiter_test.go`（TEST_REDIS_ADDR skip 模式）+ `share_rate_limit_test.go`（fake limiter 三态——**Review Focus 3**）

- [ ] Step 1 中间件 fake 测先行 → Step 2 RED → Step 3 实现 → Step 4 全绿 → Step 5 Commit `feat(httpapi): client-ip rate limiting with split failure policy`

### Task A5: share_handler + 路由 + file.Service 适配

**Files:** Create `internal/httpapi/share_handler.go`；Modify `router.go`、`internal/file/service.go`（+`GetActiveFile`、+`DownloadByKey(ctx, key string) (*DownloadResult, error)`（无 owner 校验，注释标明仅供分享路径）、`PermanentDelete` 级联：`type SharePurger interface{ PurgeByFileTx(tx *gorm.DB, fileID uint64) error }` + `SetSharePurger`，`HardDeleteWithQuota` 加 `extra ...func(tx *gorm.DB) error` 变参）、`cmd/server/main.go`（注入 share repo 为 purger + limiter/limiterKind 接线路由参数表：owner 5 路由进 protected，public 组挂限流）；Test `share_handler_test.go` + `internal/file/service_test.go` 追加

**Interfaces:**
- Consumes: A3 Service（handler 依赖窄接口 `ShareAPI`＝A3 六方法）、A4 中间件。Produces: `statusForShareError(err) (int, gin.H)`（spec §3 v2 矩阵逐格）。
- 路由注册冒烟测试防 gin wildcard 冲突（`/files/:id/shares` vs `/files/instant` 未来共存；冲突备选 `/shares/file/:fileID` 以测试为准）。
- download：Access 凭证 header 或 `?access=` 皆可；先 `IncrementDownload`（失败仅日志）再开流；头三件套断言（attachment/nosniff/content-type）。**Review Focus 2 端点侧**：登录 token 打 download → 401。

- [ ] Step 1 失败测试：`TestStatusForShareErrorMatrix`（全格+%w 包装）、`TestShareCRUDViaHTTP`（create 201 形状/list/revoke 204 幂等/他人 404）、`TestPublicMetaAndDownloadFlow`（needs_password→401→verify→带 shareJWT download 200 假流+头断言；user token 401；无密码链接免 verify 直下）、`TestPermanentDeletePurgesShares`（fake 断言 extra 钩子被调）→ Step 2 RED → Step 3 实现 → Step 4 全量 race 绿（现有 file 测试不破）→ Step 5 Commit `feat(httpapi): share endpoints, cascade hooks and status-code contract`

### Task A6: e2e 真机冒烟 + 部署文档

**Files:** Create `deploy/README.md`（migration 手动应用规程 + "只前进不回滚"条目占位）；Modify `README.md`（已实现 + 分享链接行）；留痕 `.superpowers/`

- [ ] Step 1 dev 库应用 000006（docker exec mysql）→ Step 2 curl 矩阵照 spec §3 v2 表逐格（含错密×5→429、回收站 410 file_unavailable→还原复活、永久删→级联 404、`?access=` 与 header 双路）→ Step 3 `TEST_REDIS_ADDR` 真 Redis 跑 share 包；kill Redis→read 放行/verify 503→重启 → Step 4 写文档 → Step 5 Commit `docs(deploy): migration runbook and share e2e record`

### Task A7: React 访客下载页

**Files:** Modify `web/src/routes/index.tsx`（`/d/:token` + guard meta public）、`web/src/routes/guard.ts`(+test)、Create `web/src/routes/ShareRoute.tsx`、`web/src/api/shares.ts`

- [ ] Step 1 `guard.test.ts` 追加 public 放行失败测试 → Step 2 RED → Step 3 实现（meta→needs_password 表单→verify 存 shareJWT 到组件态→下载 `<a href="...download?access=">`；410 显示"链接已失效"、404"不存在"、限流 429 重试提示）→ Step 4 `npm test && npm run build` 绿 → Step 5 Commit `feat(web): public share download page`

# B 轨 · 秒传去重（5 任务，A 轨合并后开工）

### Task B1: objects + files.sha256 + blob 原语

**Files:** Create `migrations/000007_create_objects.up.sql`（spec §2.1：sha256 PK/object_key UNIQUE/size/content_type/refcount/created_at）、`migrations/000008_add_sha256_to_files.up.sql`（ADD sha256 NULL + idx + **DROP INDEX uk_files_object_key**）、`internal/file/object.go`（`type Object{Sha256, ObjectKey, ContentType string; Size int64; Refcount int}`）；Modify `repository.go`/`gorm_repository.go`（+`FindBlob(ctx, sha)`；`AcquireBlob(tx *gorm.DB, sha, contentType string, size int64) (*Object, bool, error)`——**INSERT IGNORE 先行、SELECT FOR UPDATE 后读，created=RowsAffected**；`ReleaseBlob(tx *gorm.DB, sha string) (key string, gone bool, error)`——UPDATE-1→读回→==0 删行交 key）；File 结构 +`Sha256 *string`；现有 fake Repository 补三方法（编译驱动清单）

- [ ] Step 1 build/vet 暴露 fake 缺口并补齐 → Step 2 `//go:build integration` 的 `blob_primitives_test.go`（真 MySQL 双 Acquire 并发 created 恰一真、Release 归零删行）→ Step 3 race 全绿 → Step 4 Commit `feat(file): objects schema, sha256 column and blob refcount primitives`

### Task B2: ObjectStorage.Copy + fakes

**Files:** Modify `internal/storage/storage.go`（接口 +`Copy(ctx, srcKey, dstKey string) error`）、`minio.go`（client.CopyObject）；全仓 grep 补 fake（内存 map 复制语义）；Test minio fake 行为

- [ ] Step 1 fake 测先行（src 缺失→err；成功→内容一致）→ Step 2 RED → Step 3 实现 → Step 4 全仓 race 绿 → Step 5 Commit `feat(storage): server-side copy for dedup placement`

### Task B3: InstantUpload service + 端点

**Files:** Modify `internal/file/service.go`（`InstantInput{OwnerID; Sha256, OriginalName, ContentType string; FolderID uint64}`；`InstantUpload`——sha 正则 `^[0-9a-f]{64}$`、MIME 白名单粗筛（非法→octet-stream）、FindBlob 未命中→`ErrBlobNotFound`、folder 授权、配额复用现成、事务 `AcquireBlob+Create` 走新 `CreateWithBlobTx`；响应 etag=sha、content_type=objects 值）、`repository.go/gorm_repository.go`（+`CreateWithBlobTx`）、`file_handler.go`（`Instant` handler + 404 not_found 面/200 {exists:false}/201/507）、`router.go`（`/files/instant` 注册在 `/files/:id` 组**之前**+注释）、`file/errors.go`（ErrBlobNotFound）；Tests `instant_test.go` + handler 形状测

- [ ] Step 1 失败测试：命中 201 字段来源断言、未命中 ErrBlobNotFound→handler 200 {exists:false}（**形状与 fileResponse 完全不同，测试双向钉**）、配额 507、folder 404（非本人不存在同形）、坏 sha 400 → Step 2 RED → Step 3 实现 → Step 4 race 绿 → Step 5 Commit `feat(file): instant-upload probe endpoint with refcount acquire`

### Task B4: 直传去重改造（tee + tmp + copy）

**Files:** Modify `internal/file/service.go` Upload：key `users/<uid>/tmp-<uuid>` → `io.TeeReader(src, sha256.New())` → Put → 事务{AcquireBlob；**created** → `Copy(tmp→blobs/<sha>)`+落 objects 行(content_type, size)+删 tmp；**hit** → 删 tmp}→Create file 行（sha256、blob.ObjectKey、etag=sha）；任何一步失败 best-effort 删 tmp + 回滚（孤儿交 gc）；fake storage 断言调用序列

- [ ] Step 1 失败测试：`TestUploadDedupSecondUploadNoPutToBlob`（第二次不产生 blobs Put、tmp 被删、refcount 2）、`TestUploadHashCorrect`、`TestUploadFailureCleansTmp`（Acquire 报错→tmp 删除+无 file 行）→ Step 2 RED → Step 3 实现 → Step 4 race 全仓绿（Upload 既有测试适配 fake）→ Step 5 Commit `feat(file): content-addressed placement with dedup on direct upload`

### Task B5: refcount 释放 + blob-gc + e2e 终验

**Files:** Modify `internal/file/service.go` PermanentDelete（sha!=nil→事务{quota+删行+ReleaseBlob}**零 storage.Delete**；sha==nil 老路径不变；**与 A5 的 SharePurger 钩子在同一 extra 里共存**）；Create `cmd/blob-gc/main.go`（env 同 server；`--max-age duration=1h`、`--dry-run`；决策纯函数 `func gcDecision(objs []ObjectRow, blobs []BlobEntry, now time.Time, maxAge time.Duration) []string`）；Tests：PermanentDelete 分叉（fake 断言去重路径 storage.Delete **调用数=0**）、gc 决策三态（无行超窗→删；行刚重建→不删；窗内→不删——Review Focus 5）；e2e 照 spec §8 全序列（A 传→B instant 命中→A 回收站 refcount 不动→A 永久删→B 下载完好→B 永久删→行灭 blob 存→gc --max-age 0→blob 灭）

- [ ] Step 1 单测先行 → Step 2 RED → Step 3 实现 → Step 4 全仓 race + integration（有真库则跑 B1/B5 集成组）→ Step 5 e2e 留痕 + deploy/README 补"只前进不回滚"正文（spec §7）→ Step 6 Commit `feat(file): refcount release, blob-gc sweeper and dedup e2e`

---

## 收尾
全量门：`go test -race ./... -count=1`、TEST_REDIS_ADDR 套、web build/test（A7 后跑一次）、A6/B5 e2e 留痕齐、spec 勾选状态回写。合并决策归用户（不沿用历史授权）。秒传 React 接线 = 后续独立任务，不在本计划。
