# W 轨实施计划：属主分享 UI + 秒传前端接线

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 React 前端补齐属主分享管理（弹窗+我的分享页）与秒传探针接线，零后端改动。

**Architecture:** 复用现有模式——MoveDialog 的 Modal+useMutation、actions.ts 的 invalidation 表、uploads.ts 的 UploadDeps 注入纯逻辑。owner API 走 client.request（带 auth），访客 publicRequest 红线不动。

**Tech Stack:** React Router + TanStack Query + sonner + glinui vendored + vitest/jsdom；Web Crypto（subtle.digest）。

**Spec:** `docs/superpowers/specs/2026-11-26-share-owner-ui-and-instant-web-design.md`（分支内 02c080c）

## Global Constraints

- 工作目录 `d:/Codex_code/code1/PersonalCloudStorage/.claude/worktrees/share-instant`（分支 worktree-share-instant）；每 git 写前 `git rev-parse --show-toplevel` 验尾（cwd 事故前科）。禁碰主仓 git。
- 门：`cd web && npm test`（vitest 全量，当前 400 例）+ `npm run build` 绿后才许提交；每任务一提交，英文 conventional。
- 禁新依赖。文件行判定沿用现有 canAsk/canPreview 风格。
- A7 红线：`api/shares.ts` 的 `publicRequest` 及访客函数不得改动；owner 新函数只许经 `client.request`。
- 秒传探针失败（任何非 201 形状）→ 静默降级直传，用户不可见；≥49MiB 分片路径零改动。
- 中文 UI 文案与现有 translateError 风格一致。

## Review Focus

1. 探针永不成为可见错误路径（409/507/网络全静默降级，由直传复现真错误）→ W3 测试钉。
2. 改 shares.ts 属主段时破坏访客无 Authorization 红线 → W1 必须保持 A7 既有测试原样绿 + 新增"owner 请求带 token / 访客不带"对偶断言。
3. 探针期间取消：不再有后续任何请求（deps 调用计数）→ W3。
4. 分享入口只出现在活跃视图的文件行（文件夹/回收站/详情页无）→ W1 渲染断言。
5. URL 用 `location.origin`（dev 5173/prod 同源）；clipboard 失败回退可见选中文本 → W1。

---

### Task W1: 属主 API 段 + ShareDialog + 行入口

**Files:** Modify `web/src/api/shares.ts`（追加 owner 段：createShare/listShares/revokeShare/shareUrl，全走 client.request）、`web/src/features/files/RowContextMenu.tsx`、`web/src/features/files/FilesPage.tsx`（ShareDialog state 挂载 + DetailPanel 派生动作组注入"分享"——DetailPanel 是纯呈现件，动作从页面注入，勿在面板组件里加业务）、`web/src/api/client.ts`（translateError 表补 404/409 share 面文案）；Create `web/src/features/files/ShareDialog.tsx` + `share-dialog.test.tsx`。**注意 builder-check 裁定：RowToolbar 不放（abc-4 浮条仅批量）。**

**Interfaces:** Produces `createShare(fileId:number, opts:{password?:string;expires_in?:number}): Promise<ShareItem>`、`shareUrl(token):string`；`ShareDialogProps {target: FileRow|null; onClose():void}`（对齐 MoveDialogProps 形状）。

- [ ] **Step 1:** 写失败测试：成功→显示 URL 含 origin 与 token + 复制按钮调 clipboard（mock）+ clipboard reject 时走回退不崩；密码 UTF-8 >72 字节提交前红字不发请求；409 body→「分享数量已达上限」；文件夹行/回收站视图不渲染入口（组件级断言）。
- [ ] **Step 2:** RED。
- [ ] **Step 3:** 实现（Modal 复用 vendored modal 组件，MoveDialog 为师；有效期 select 五档→秒数；成功后 dialog 内切换到结果态）。
- [ ] **Step 4:** 全量 vitest + build 绿（A7 原测试必须原样绿）。
- [ ] **Step 5:** Commit `feat(web): owner share dialog with password/expiry`。

### Task W2: “我的分享”页 + 导航

**Files:** Create `web/src/features/shares/SharesPage.tsx`、`shares-page.test.tsx`；Modify `web/src/routes/index.tsx`（authed /shares 路由进 AppLayout）、`web/src/components/app/`（侧栏/nav 数据源——实施时先读 AppLayout 现有 nav 结构，按其惯例加项，图标 lucide Share2）。

**Interfaces:** Consumes W1 `listShares/revokeShare/shareUrl`。Produces 路由 `/shares`。

- [ ] **Step 1:** 失败测试：渲染三态标签（有效/已过期/已撤销）、复制钮、撤销按钮 204→query invalidation 后行内状态更新、空态文案、revoked 行无撤销钮。
- [ ] **Step 2:** RED → **Step 3:** 实现（useQuery ['shares'] + useMutation revoke；样式沿 FilesTable 玻璃行语言，别自创）。
- [ ] **Step 4:** 全量绿+build → **Step 5:** Commit `feat(web): my-shares management page`。

### Task W3: 秒传探针接线

**Files:** Modify `web/src/lib/uploads.ts`（UploadDeps 增 `sha256Hex(buf)` 与 `instantProbe({sha256,original_name,content_type,folder_id}): Promise<'linked'|'miss'|'error'>`；直传分支前置探针逻辑 §1.2；UploadTask 可加 `instant?: boolean` 标记）、真实 adapter 所在 api 层（`web/src/api/storage.ts` 加 instantUpload probe 函数经 client.request；subtle adapter 放 uploads 入口文件底部或 lib/crypto.ts 新文件）、`uploads.test.ts` 追加用例；FilesPage 上传完成处 instant→toast「秒传成功」（先读现有 done-toast 位置）。

**Interfaces:** Produces deps 契约两函数；probe 201→'linked'、200{exists:false}→'miss'、其余→'error'。

- [ ] **Step 1:** 失败测试：linked→任务 done 且 putDirect **未被调用**、toast 参数含秒传；miss→putDirect 调用一次与旧行为一致；error(507 例)→静默走 putDirect（用户看不到 507 双弹）；linked 前 cancel→无任何后续调用且状态 cancelled；hash 输入=文件 arrayBuffer 原字节（fake subtle 记录参数）；≥49MiB→probe 从不被调。
- [ ] **Step 2:** RED → **Step 3:** 实现（探针段包 try/catch→'error' 降级；signal 检查在 digest 前后各一次）。
- [ ] **Step 4:** 全量绿（Task 8 既有上传测试全数原样）+build → **Step 5:** Commit `feat(web): instant-upload probe before direct upload`。

注：W3 实际契约以 spec 修订为准——probe 返回 linked|miss+throw 静默降级、无独立秒传 toast（徽标）、无新 FileActionType。

### Task W4: 真机 UI 剧本 + 文档回写

- [ ] 栈已在线（8080/8001/5173 或重启）；`npm run dev` 后 playwright? **无浏览器自动化**→ curl 级验证 probe/dialog API 面 + **用户手测剧本写进报告**（建链→无痕→429→撤销；上传 bob 同字节文件→秒传成功 toast）。
- [ ] feature-progress/changelog（React 侧惯例：web/docs 的 changelog 文件，先读再加行）、README 已实现两行更新；commit `docs(web): W-track live verification record`。

## 收尾
四任务后：整 W 轨终审（opus，ad8714a..HEAD 全量含 A/B 已审部分聚焦 W diff），合并决策仍归用户。
