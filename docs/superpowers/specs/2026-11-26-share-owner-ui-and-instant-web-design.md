# W 轨设计附录：属主分享 UI + 秒传前端接线

- 日期：2026-11-26 ｜ 状态：待审查 ｜ 上游：share-links spec v2 §1（owner UI 另立）、instant spec v2 §5.5（前端推迟）——本文即这两个"另立"
- 交付边界：纯前端（web/），零后端改动；两功能各一个任务包 + 一个收尾包

## 1. 功能介绍与实现逻辑

### 1.1 属主分享管理（W1）
用户在文件列表对**文件行**（非文件夹、非回收站视图）发起"分享"：
- 弹窗（复用 MoveDialog 的 Modal 模式）：可选访问密码（≤64 字符且 UTF-8 ≤72 字节前端预检，与服务端 `ErrPasswordTooLong`→400 同语义，避免 400 才知）、有效期选择（永久/1h/1d/7d/30d → 秒数）、提交 `POST /api/v1/files/:id/shares`。
- 成功态就地转为"链接已生成"：显示 `${origin}/d/<token>` 全 URL + 复制按钮（navigator.clipboard，失败回退选中文本）+ 继续关闭。
- Dock 新增"我的分享"入口（无侧栏，导航=底部 Dock，图标 Share2）→（路由 /shares）：`GET /api/v1/shares` 列表——文件快照名、链接（复制）、有效期、下载次数、状态列**只标事实态**（已撤销/已过期/未到期）——shareResponse 无文件状态字段，回收站死链不可见（backlog：后端补 file_status 后升级"链接失效"标签），故**不做"有效"承诺、不做 N+1 懒探测**，操作列"撤销"`DELETE /api/v1/shares/:token`（已撤销行不显示撤销钮）。空态文案。
- 错误透传：409 too_many_shares → toast「分享数量已达上限（单文件 20 / 账号 50）。」——双上限一个中性串；404/410 → **允许在 client.ts translateError 表新增分支**（not_found→「分享不存在或已删除。」等，纯前端表非后端改动）。

### 1.2 秒传前端接线（W2）
直传通道（`size < 49MiB` 阈值以下，维持 multipart 大文件不探针的 v1 边界）：
1. `file.arrayBuffer()` → `crypto.subtle.digest('SHA-256')`（**已知代价**：SubtleCrypto 无流式 API，峰值内存≈文件大小，49MiB 封顶可接受；JS 手写分块实现否决——引入非标准密码代码，简历项目不可取）。
2. `POST /api/v1/files/instant {sha256, original_name, content_type, folder_id}`：
   - 201（命中）→ 任务直接 done（percent 100），toast「秒传成功」，命中即完成复用 `useUploadManager.invalidateFileViews()`（['files']+['usage']）与既有 done 分支，**不新增 FileActionType**；批次尾 toast 统一「已上传 N 个文件。」**不另弹秒传 toast**，差异以队列行内「⚡秒传」徽标呈现（UploadTask.instant 标记）；
   - 200 `{"exists":false}`（未命中）→ **原样继续既有直传流程**（探针是机会主义优化，服务端随后 tee 哈希自然入账）；
   - 探针任何失败（401/409/507/网络）→ 同样**静默降级为普通直传**（配额/登录错误由直传原样复现，用户零双弹），让真正的上传路径给出用户熟悉的错误（配额/登录过期错误将由直传原样复现）。401 例外？——否，降级路径自己会 401，行为一致，不加特例。
3. 哈希计算失败（无 subtle 的旧环境/内存拒绝）→ 降级直传，不阻断。
4. **hashing 阶段 UI 态（builder-check 裁定）**：不新增状态——探针+哈希期间任务保持 `queued 0%`（≤2s 窗口），命中→done、未命中→uploading；`busy` 计算不变，状态机/队列面板零重做。
5. **取消语义**：探针/哈希期间取消并入既有 cancelled 分支（halted 熔断保持）；既有文案「已取消当前大文件上传。」对直传小文件是事实错误，W3 顺带改为「上传已取消。」并同步其钉测——有意变更，评审可见。

## 2. 数据模型
无新表。前端类型：
```ts
// api/shares.ts 追加属主段
interface ShareCreateOptions { password?: string; expires_in?: number }
interface ShareItem { id; token; display_name; expires_at: string|null; download_count: number; revoked: boolean; created_at }
createShare(fileId, opts) → ShareItem   // client.request，带 auth
listShares() → { items: ShareItem[] }
revokeShare(token) → void(204)
shareUrl(token) = `${location.origin}/d/${token}`
```
`lib/uploads.ts`：`UploadDeps` 增注入点 `sha256Hex(buf: ArrayBuffer): Promise<string>` 与 `instantProbe(input): Promise<'linked'|'miss'>`——真实实现在薄 adapter（不进单测），编排逻辑纯函数可全 fake（沿用 Task 8 零真网络测试模式）。

## 3. 控制层（路由/入口接线）
- `routes/index.tsx`：/shares 路由（authed，AppLayout 内）+ nav 项（sidebar 现有 navTrail/图标体系内新增，图标 lucide `Share2`）。
- 入口=**RowContextMenu + DetailPanel 动作组**（遵守既有 abc-4 裁定：浮条 RowToolbar 只放批量动作，单目标动作唯一页侧载体是 DetailPanel，FilesPage 负责 dialog state 挂载）；回收站视图/文件夹行不出现。
- 新文件：`features/files/ShareDialog.tsx`、`features/shares/SharesPage.tsx`（新 feature 目录，对齐 files/trash 惯例）。

## 4. 逻辑层
- `actions.ts`：`FileActionType` 增 `'instant'`（invalidations 与直传成功同键）；分享弹窗内部用 `useMutation`（MoveDialog 同款），无跨页共享状态。
- 上传编排 `uploadFiles`：直传分支前置探针段（§1.2 顺序），**分片分支零改动**；每任务信号贯通（探针期间取消→中断，任务 cancelled）。
- 文案：中文，风格沿现有 translateError 表。

## 5. 数据操控层
不适用（纯前端，无 DB/存储改动）。API 层即 §2 类型 + 复用 client.request 的 auth/错误形状。

## 6. 中间件（涉及组件与依赖）
零新依赖（subtle/clipboard/现有 react-query/sonner/glinui Modal）。测试栈不变：vitest + jsdom（**无 crypto.subtle** → 编排测全走注入 fake；真实 adapter 一行实现不进单测，与 uploads.ts 既有"真 fetch 薄层不测"惯例一致）。

## 7. 安全与文案红线
- 属主 API 一律走 `client.request`（带用户 JWT），访客 `publicRequest` 零 Authorization 的既有红线不得被 W1 破坏（两模块共文件不同函数，注释分区）。
- 分享 URL 复制进剪贴板视为敏感（token 即凭证）：仅显式点击才复制。
- 撤销成功 toast + 列表就地更新（invalidation on ['shares']）。

## 8. 测试与验收
- W1 单测：ShareDialog（成功→URL 呈现与复制调用、密码 72 字节预检拒绝、409/500 面）、SharesPage（列表渲染/过期态标签/撤销 204 后失效/空态）、行菜单只在文件行出现；`npm test`+`npm run build` 绿。
- W2 单测（注入 fake）：命中→任务 done+probe 后**不再** PutObject（deps 断言）、miss→走原直传、探针炸→走原直传、探针期间 cancel→cancelled 且无后续请求；哈希输入为文件字节（fake subtle 断言收到的 ArrayBuffer 与原文件一致）。
- W4 真机剧本（**本地栈 8080/5173，demo/alice/bob 账号**；生产 secplusplus.xyz 不灌测试数据——builder-check 裁定）：demo 账号 UI 建密码分享→无痕开链接→错密 5 次→429 文案→对密下载；alice UI 上传 bob 已有内容的同字节文件→toast「秒传成功」+ objects.refcount+1 实况；两链路演示后 feature-progress/changelog 记录、README 更新"分享管理 UI/秒传前端"已实现行。

## 9. 非目标
分享页 SEO/密码长度策略调整/水印；"我的分享"分页（个人量级全量即可）；大文件秒传；探针结果缓存。
