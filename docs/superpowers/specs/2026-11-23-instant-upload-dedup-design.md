# 秒传 / 内容去重 开发文档

- 日期：2026-11-23 ｜ 状态：**v2 简化版（2026-11-24 用户批准：移除 `X-Content-Sha256` 客户端自检；React 接线推迟为后续独立任务）** ｜ 关系：share-links v2 先行合并后实施（migration 000007/000008）
- 目标读者：实施工程师。本文档即契约。

## 1. 功能介绍与实现逻辑

### 1.1 功能
用户上传文件前，客户端先算内容哈希（SHA-256）问服务器："这个内容存在吗？"存在则**不传字节**，直接为用户建一条文件记录（秒传成功，毫秒级）；不存在则走原上传通道，服务器在流式落 MinIO 的同时旁路算哈希记账。物理上相同内容全服务器**只存一份**（内容寻址 blob），不同用户、同一用户重复传皆然。

### 1.2 三条已定夺的设计决策（含理由，实施不得动摇）
1. **配额语义**：秒传的文件**照常按 size 计入用户 used_bytes**。去重省的是服务器磁盘（物理层），配额是逻辑记账层，两者解耦。副作用（已知并接受）：全局磁盘用量 ≠ Σ用户用量。
2. **v1 范围**：去重只覆盖 **≤50MiB 的直接上传通道**（`POST /files`）。分片上传通道（8MiB×N，数据根本没经过 Go）**v1 不去重**，保持现状 uuid key——因为分片完成后的哈希校验需要回读 MinIO 全量流，成本模型不同，列为后续演进（§9）。客户端对分片大文件不弹秒传选项。
3. **存在性预言机（existence oracle）接受**：秒传探针会泄露"库里存在某内容的文件"（他人可猜测哈希试探）。网盘行业接受此代价；防御（收敛加密/按用户命名空间哈希）= 去重失效，明确不做。安全清单（§8）只保证不泄露**谁的**、**叫什么名**。

### 1.3 实现逻辑（生命周期）
```
探针：client POST /files/instant {sha256, original_name, folder_id}
      → blob 命中：配额检查 → [事务] refcount+1 + files 行(blob key) → 201 FileResponse(与真实上传响应逐字段同形)
      → blob 未命中：200 {exists:false} → client 转普通上传
直传：client POST /files (multipart) → Go 用 io.TeeReader 边流边 sha256 → 落 MinIO 临时 uuid key
      → [事务] SELECT objects FOR UPDATE WHERE sha256=?：
           命中 → refcount+1，files 行挂既有 blob key，**删除刚上传的冗余对象**（best-effort，孤儿由对账兜底）
           未命中 → objects 插入(sha256→key=blobs/<hex>, size, refcount=1)
删除：SoftDelete 不动物理（回收站语义：还原要秒回）；PermanentDelete [事务] refcount-1 → 归零则**只删 objects 行**，MinIO 物理对象交延迟 GC 清理（见 §1.4，杜绝删错在用对象）
```

### 1.4 物理删除：延迟 GC（builder-check 裁定的关键安全决策）
**v1 不在 PermanentDelete 事务后同步 `storage.Delete`。** 反例竞态（审查员构造）：事务 T1 提交"refcount 归零、删 objects 行"后、`storage.Delete(blobs/x)` 落地前，另一上传 T2 AcquireBlob 未命中 → 重新 INSERT + CopyObject 到同 key → T1 迟到的 Delete 把 T2 刚建好的对象删掉，DB 显示 refcount=1 而内容已毁 = **静默数据丢失**。

定案：PermanentDelete 只做逻辑层（refcount-1、归零删 objects 行）；**物理 blob 清理由独立 `cmd/blob-gc` 负责**，规则="扫描 `blobs/` 前缀对象，删除 DB 中无对应 objects 行且对象 age > 安全窗（默认 1h）者"。安全窗确保任何"已删行但未及物理删"的对象不会与"刚重建同 sha 对象"竞争。代价：refcount 归零到磁盘回收有延迟（v1 接受，配额不受影响——配额看 files 行不看物理）。
> 注：这也是对**现有代码顺序**（`PermanentDelete` 先 `storage.Delete` 后 `HardDeleteWithQuota`，本身就有"删了对象元数据没删→重试又发现元数据"的脆弱性）的纠正——去重引入后必须行先行、物随后。

## 2. 数据模型

### 2.1 新表 `objects`（migration `000007_create_objects.up.sql`）
| 列 | 类型 | 说明 |
|---|---|---|
| sha256 | CHAR(64) PK | hex 小写，内容即身份 |
| object_key | VARCHAR(255) UNIQUE NOT NULL | 物理 key：`blobs/<sha256>` |
| size | BIGINT NOT NULL | 字节数（配额与磁盘差值核算用） |
| content_type | VARCHAR(127) NOT NULL | 首个上传者定值（秒传复用；见 §2.3） |
| refcount | INT NOT NULL | 引用者数；**归零当行即删**，不留 0 行 |
| created_at | DATETIME | |

**content_type/etag 空洞（builder-check 裁定）**：秒传命中时 fileResponse 的 `content_type` 从 objects 表复用（首个上传者的判定值，后来者同名不同 MIME 的边缘=接受，反正下载名由 files.original_name 定）；`etag` 直接回 sha256（对去重文件二者同义）。**不再往 objects 加 etag 列。**

### 2.2 `files` 变更（migration `000008_add_sha256_to_files.up.sql`）
- 加列 `sha256 CHAR(64) NULL`，索引 `idx_sha256`。NULL=历史遗留行（存量文件永不回填，§9）。
- **DROP 现有唯一索引 `uk_files_object_key`（builder-check 抓出的契约冲突）**：去重后多行共享同一 object_key，UNIQUE 约束必炸。migration 内容 = `ALTER TABLE files ADD COLUMN ...` + `DROP INDEX uk_files_object_key`。代价评估：现网 files 表行数很小（个人网盘+测试数据），MySQL 8 INSTANT/INPLACE 秒级完成，**无需低峰窗口**（若未来表巨大再议 pt-osc）。
- **files.object_key 语义变化**：新上传行允许与 objects.object_key 重复指向（共享物理对象）；历史行继续独占。删除路径必须以"是否走 objects 记账"分叉——判定依据：`files.sha256 IS NOT NULL` 则查表减引用，NULL 走老逻辑直删。

### 2.3 探针/响应契约
`POST /api/v1/files/instant` → JWT 必需。
Req `{sha256: hex64 正则, original_name: 1..255 runes, folder_id?: uint, content_type: string(≤127, 必填——客户端声明，服务端 MIME 白名单粗校验，非法值退 application/octet-stream)}`；
- 命中 201：标准 fileResponse（content_type 取 objects 行，etag=sha256，与 `POST /files` 逐字段同形）
- 未命中 200：`{"exists": false}` —— **用响应形状区分而非状态码**
- 错误：400 形状非法 / **404 文件夹不存在或非本人（对齐 file handler 现状：FolderAuthorizer 不区分 403/404，统一 404——builder-check 裁定）** / 507 配额不足（与直传一致）。

## 3. 控制层
- `file_handler.go` 增 `InstantUpload` handler（路由 `api.POST("/files/instant", ...)` 进 protected 组，**必须注册在 `/files/:id` 系列之前避免路由吞并**——gin 按注册序，`/files/instant` 静态段无冲突，仍加注释钉住顺序约定）。
- 直传 `Upload` handler 不变（v2 移除可选 `X-Content-Sha256` 头：服务端 TeeReader 自算即权威，客户端自检属优化非契约，砍）。
- 探针端点错误映射见 §2.3；其余沿用 file handler 现状（507 等）。

## 4. 逻辑层（`internal/file/service.go` 扩展，新文件 `blob.go` 放哈希工具）

```go
// Repository 接口追加（§5）：
//   FindBlob(ctx, sha256) (*Object, error)
//   AcquireBlob(ctx, tx, sha256, objectKey, size) (*Object, bool /*created*/, error)  // FOR UPDATE 事务内 upsert+refcount+1
//   ReleaseBlob(ctx, tx, sha256) (deleteKey string, toDelete bool, err error)          // refcount-1；归零删行并交出 key
//   LinkFile / UnlinkFile 既有路径带 sha256 字段

func (s *Service) InstantUpload(ctx, ownerID uint64, in InstantInput) (*File, error)
  // 校验哈希形状 → FindBlob → 无则 exists=false 语义(err=ErrBlobNotFound)
  // 有：folder 授权(FolderAuthorizer 现成) → 配额(usedBytes+size≤quota 现成) → 事务{AcquireBlob(refcount+1) + Create file 行}

func (s *Service) Upload(...) 改造：
  tee := io.TeeReader(src, sha256.New()); Put 到临时 key "users/<uid>/tmp-<uuid>"
  → 事务{ AcquireBlob；created? objects.key 即最终位置——注意：**直接 Put 到 blobs/<sha256> 不现实**（PutObject 需先算完哈希才能定 key，
     而流式哈希要传完才知）→ 定案：先传 tmp key，事务命中已有 blob 则 Delete tmp（best-effort），未命中则
     **CopyObject tmp→blobs/<sha256> 再 Delete tmp**（storage 接口需补 `Copy(ctx, srcKey, dstKey) error`，MinIO 原生服务端复制，零流量）；
     未命中路径 objects 行记 blobs key } → Create file 行(sha256, blobs key)
  失败补偿：事务回滚时 best-effort Delete tmp；孤儿 tmp/blobs 由对账命令清（§9）

func (s *Service) PermanentDelete 改造（现有方法是 storage.Delete 先、HardDeleteWithQuota 后）：
  file.sha256 != nil → 事务{ 原 quota 记账 + 删 file 行 + ReleaseBlob }——**事务内不再触 MinIO**；归零只删 objects 行，物理 blob 由 cmd/blob-gc 按 §1.4 安全窗回收
  file.sha256 == nil → 现状逻辑不变（先删对象后删行，遗留行为，历史行不参与去重故无共享风险）
```
- 不变式：`objects.refcount == COUNT(files WHERE sha256=? AND status IN(active,deleted))`（回收站行**仍算引用**，还原免费的设计闭环）；仅在两个事务点（Acquire/Release+file 写）内变更。

## 5. 数据操控层（`internal/file/gorm_repository.go` + 接口 `repository.go`）
- §4 三个新接口方法的 SQL 语义钉死：
  - `AcquireBlob`：`SELECT ... FOR UPDATE` 命中→`UPDATE refcount=refcount+1`；未命中→`INSERT`（`ON DUPLICATE KEY UPDATE refcount=refcount+1` 兜底竞态，`created` 以 affected rows 判读不可靠——用"先 INSERT IGNORE，再 SELECT FOR UPDATE"两步法实现，代码注释写明原因）。
  - `ReleaseBlob`：`UPDATE refcount=refcount-1 WHERE sha256=?` → 读回 → `==0` 则 `DELETE` 该行并返回 key。**并发下载-删-秒传三方竞态**：release 后新 Acquire 可能已重建行——因二者同锁同 PK 行且各自事务，串行化成立；实现时集成测试必须覆盖该交错（§8）。
- 历史 NULL-sha 行走原路径，repo 层零特判（service 分叉）。

## 6. 中间件与依赖
- **MySQL**：2 个 migration；事务边界全部在 `gorm_repository`（沿用 `HardDeleteWithQuota` 的事务先例）。
- **MinIO**：`storage.ObjectStorage` 接口**新增 `Copy(ctx, srcKey, dstKey) error`**（服务端复制）——接口变更是破坏点，`minio.go` 实现 + 所有 fake（测试里的 in-memory 实现）同步补齐。
- **Redis / agent / LLM**：无涉及。
- **Go stdlib**：`crypto/sha256`、`encoding/hex`、`io.TeeReader`。零新依赖（对比分享功能的 bcrypt，这条让两功能合并评审时依赖面更小）。

## 7. 迁移与兼容
- 上线顺序（应用方式见 share-links 文档 §9 runbook）：migration（可空列/新表/`DROP INDEX uk_files_object_key`，现网表小秒级）→ 新代码。老数据零回填；历史文件间不去重、与新文件同内容也不合并（可接受，§9）。
- **回滚剧本（唯一约束已不存在 + blob 共享，回滚有代价）**：老代码的 `PermanentDelete` 见 files 行即 `storage.Delete(object_key)`——共享 blob 会被单行删除误杀。结论：**本功能合入后代码只前进不回滚**；确需回滚时的前置=先恢复全量备份或临时禁用删除端点，写进 deploy/README 风险条目。`DROP INDEX` 的回滚（重建 UNIQUE）在有共享行时必失败——即回滚不彻底是**设计事实**，不是遗漏。

## 8. 测试与验收
- 单测（fake storage 加 Copy + 计数）：InstantUpload 命中/未命中/配额拒；Upload tee 哈希正确性；blob 命中后 tmp 清理被调用；HardDelete 三方竞态事务在 sqlite/容器化 MySQL 集成测（仓库现状无 DB 集成层则此条标 `//go:build integration` 留接口，真机冒烟覆盖）。
- handler：instant 响应形状与 `POST /files` 逐字段一致（防前端分支）。
- 真机冒烟：用户 A 传 1MB txt → 用户 B instant 命中 201 且 B 的 used 增加、`objects.refcount=2` → A 进回收站 refcount 不动 → A 永久删 → refcount=1 对象与行俱在 → B 下载完好 → B 永久删 → **objects 行消失但 blob 仍在**（安全窗内）→ 跑 `go run ./cmd/blob-gc --max-age 0` → blob 消失（`mc ls` 断言）。
- §1.4 数据丢失窗口的回归测试：并发"最后引用 PermanentDelete + 同 sha 新上传"交错（集成层，断言新文件下载完好——旧同步删方案下此测试必挂，这就是它的价值）。

## 5.5 交付物清单（builder-check 后钉死）
后端：migration×2、`objects` repo/service 逻辑、instant 端点、Upload tee 改造、PermanentDelete 事务改造、`storage.ObjectStorage.Copy`、**`cmd/blob-gc` 最小实现（in-scope：扫前缀+查行+max-age 参数，无守护进程，cron 文档注记）**。
前端（React web/）：**v2 推迟**——Web Crypto 分块哈希 + 探针接线改为后续独立小任务（后端 curl/脚本验收先行），不进本轮 12 任务。
**实施顺序（与分享线协商裁定）：share-links 先行合并（占 000006 + 建 deploy/README runbook），本功能随后（000007/000008，`PermanentDelete` 二次改造在 share 的级联删除之上 rebase，同事务合并由实施者按本文 §4 终态实现）。禁止并行改 `file.Service`。**

## 9. 非目标 / 后续演进（明说，不许在 v1 偷做）
- 分片通道去重（需客户端声明哈希 + Complete 后异步回读校验 + 隔离区状态机）。
- 历史文件 sha256 回填 / 存量合并（后台对账命令 `cmd/dedup-audit`：扫孤儿 blobs/tmp、回填 hash、合并重复对象——独立立项）。
- 跨用户"谁引用"泄露面的进一步收紧、收敛加密。
