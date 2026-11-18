# React + Glin UI 前端重写实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计 spec v2.1 将 `web/` 从 Vue+Element Plus 重写为 React 19 + vendored Glin UI（底部 glass-dock 布局、液态玻璃视觉），功能 1:1 平移。

**Architecture:** 全部 UI 组件取自 glinui.com 注册表 vendor 进 `web/src/components/glinui/`（离线构建）；api/store/lib 层纯 TS 可单测；页面按 spec §5 五屏；后端仅加 `quota_bytes` 一个字段。全程受两份新文档约束：开发规范（执行前必读）与改动追踪 changelog（每任务提交必更新）。

**Tech Stack:** React 19, Vite, TypeScript strict, Tailwind CSS v4 + @glinui/tokens, @glinui/motion, TanStack Query, zustand, react-router v7, vitest(+jsdom), lucide-react, sonner。

**Spec:** `docs/superpowers/specs/2026-11-18-react-glinui-frontend-rewrite-design.md`（v2.1，随本计划一并阅读）

## Global Constraints

每个任务的实现都隐含包含本节。

- 分支：`feat/react-glinui-rewrite`（Task 1 创建；此后所有提交在该分支）
- UI 只用 vendor 的 Glin UI（`src/components/glinui/`）+ 自建 `src/components/app/`；**禁止**其他 UI 组件库；**禁止**安装 `@glinui/ui` 运行时 npm 包
- Tailwind 类 + `@glinui/tokens` CSS 变量是唯一配色来源；不写 hex/rgb 字面量（`asset-credits` 与 vendor 源码内部除外）
- 会话存储兼容旧版：sessionStorage `acs.access-token` / `acs.expires-at` / `acs.user`；localStorage `acs.multipart.<uid>`（记录字段 `id,name,size,lastModified,folderID,expiresAt`）
- 分片阈值：`file.size >= 49 * 1024 * 1024` 走 multipart，否则直传；问答限制：`file.size > 1 << 20` 禁用、问题 `maxLength 500`
- API 与旧版 1:1（spec §6 表），错误中文映射 `translateError` 全部条目移植；后端唯一改动：`/api/v1/storage/usage` 响应加 `quota_bytes`
- 素材：禁止 AI 生成；只用网络现存设计，许可证限 MIT/CC0/CC-BY；每个素材登记 `web/docs/asset-credits.md`（名称/来源 URL/作者/许可证）
- 每个任务完成后：向 `web/docs/13-react-rewrite-changelog.md` 追加一行（日期、commit、任务名、改动摘要、对应 spec 节、测试证据），与代码同 commit
- 每个任务开始前：通读 `web/docs/12-react-rewrite-development-standards.md`
- commit message 用 Conventional Commits（feat/fix/test/docs/refactor 前缀）
- dev server：`host 127.0.0.1, port 5173`，proxy `/api`、`/healthz` → `http://127.0.0.1:8080`
- 构建门槛：`npm run build`（`tsc -b && vite build`）零错误；最终 JS gzip < 250KB
- Go 侧：`go build ./... && go test ./...` 全绿
- `npx glinui` CLI 不在本计划使用（沙箱策略拦第三方执行）；vendor 一律走 `https://glinui.com/r/items/<name>.json` 手工抓取（已验证可达；失败重试即可）

## Review Focus

spec 未写成任务、但真实会咬人的输入类；每条在归属任务里钉一条测试。

1. **token 过期（401）** → 应：当前请求抛 ApiError、会话被清、跳 `/login`、toast「登录已过期」，无白屏。测试在 Task 3。
2. **续传会话已失效（404/409）** → 应：本地记录被 forget、自动重新 start 全新上传、队列不残留卡死任务。测试在 Task 8。
3. **深链/刷新 `?folder=N`** → 应：面包屑显示完整祖先链；遍历失败时降级显示当前目录名且文件列表照常加载。测试在 Task 6。
4. **移动/重命名后返回或缓存失效** → 应：源目录、目标目录、面包屑、用量四者都被 invalidate，无幽灵行。测试在 Task 9（纯函数 `computeInvalidations`）。
5. **配额超限（409 "storage quota exceeded" / 507）** → 应：任务标失败并显示「云仓可用存储空间不足。」，可续传记录保留，清理后可重试成功。测试在 Task 8。

---

### Task 1: 分支、骨架、两份治理文档与素材候选

**Files:**
- Create: 分支 `feat/react-glinui-rewrite`
- Delete: `web/src/`（旧 Vue 全部）、`web/index.html`、`web/vite.config.ts`、`web/package.json`、`web/package-lock.json`、`web/tsconfig*.json`、`web/components.d.ts` 相关（`git rm`；`web/docs/` 全部保留）
- Create: Vite react-ts 模板骨架于 `web/`（package.json、vite.config.ts、tsconfig*.json、index.html、src/main.tsx、src/App.tsx、src/vite-env.d.ts）
- Create: `web/postcss.config.mjs`、`web/src/index.css`
- Create: `web/docs/12-react-rewrite-development-standards.md`
- Create: `web/docs/13-react-rewrite-changelog.md`
- Create: `web/docs/asset-credits.md`
- Modify: 根 `.gitignore`（若模板产物已覆盖则不动）

**Interfaces:**
- Produces: 可构建的 React 骨架；`npm test`（vitest）可运行；两份治理文档路径全局约束引用

- [ ] **Step 1:** `git checkout -b feat/react-glinui-rewrite`；`git rm -r web/src web/index.html web/vite.config.ts web/package.json web/package-lock.json` 及旧 tsconfig 文件（保留 `web/docs/`）；commit `chore: remove vue frontend for react rewrite`
- [ ] **Step 2:** 在 `web/` 生成 react-ts 模板（`npm create vite@latest . -- --template react-ts`，注意不要清掉 docs/；或临时目录生成后拷入）；`npm install`；追加依赖：`tailwindcss @tailwindcss/postcss postcss @glinui/tokens @glinui/motion @tanstack/react-query zustand react-router sonner clsx tailwind-merge class-variance-authority lucide-react`，dev 依赖：`vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom vite 自带` 与 `npm i -D`；`src/App.tsx` 换成占位 `<h1>ACS</h1>`
- [ ] **Step 3:** 写 `web/vite.config.ts`：react 插件 + server（Global Constraints 的 host/port/proxy）+ `test` 段（environment jsdom, setupFiles `src/test-setup.ts`）；`src/index.css` 两行 `@import "tailwindcss"; @import "@glinui/tokens/theme.css";`（main.tsx 引 index.css，删 App.css 与模板样式）
- [ ] **Step 4:** 验证门槛：`npm run build` 与 `npm test -- --run` 均通过（模板自带 0 测试时加一条 `src/lib/smoke.test.ts`：`expect(1+1).toBe(2)`）
- [ ] **Step 5:** 写 `12-react-rewrite-development-standards.md`（≤150 行，大纲逐节写）：目录职责（api/stores/lib/components-glinui/components-app/features/routes/providers）；命名（组件 PascalCase、文件 kebab-case、hook `use` 前缀）；TS 规则（strict+`noUncheckedIndexedAccess`，禁 `any`/`as` 兜底须注释理由）；样式规则（tokens 唯一配色；`.dark` 主题类；禁内联 style 除非动效计算值）；状态规则（服务端数据只走 TanStack Query，key 规范 `['files',folderId,page]` 等见 spec §6；跨组件 UI 状态才进 zustand）；错误规则（一律 `ApiError.message` 直显 + sonner toast；禁 console.log 上生产）；上传/问答等异步必须透传 AbortSignal；测试规则（纯逻辑必测，UI 关键流程手测清单入 changelog）；提交规则（conventional commits + changelog 行 + 每任务一提交序列）；vendor 规则（`components/glinui/` 文件头 `// vendored from glinui.com/r/<name>.json @<date>`，不得手改源码——缺陷走 `components/app/` 覆写件）
- [ ] **Step 6:** 写 `13-react-rewrite-changelog.md`：表头 `| 日期 | commit | 任务 | 摘要 | spec 节 | 测试证据 |` + Task 1 首行
- [ ] **Step 7:** 素材候选：lucide-react 图标集（MIT）为主图标源；favicon/主 logo 从 simple-icons、OpenGameArt CC0 像素包等现存设计中选 3 个候选（云/土拨鼠主题，附来源 URL+许可证）写入 `asset-credits.md` 候选区；`web/public/images/` 拷入现有 `cloud-gopher-pixel.png`、`go-mouse-pixel-v2.png` 并登记为「仓库既有保留素材，来源待用户补充」
- [ ] **Step 8:** **暂停点（用户决定）**：向用户展示 3 个 logo 候选与 `cloud-gopher-pixel.png` 的来源确认；得到答复后把选定项从「候选」挪到「采用」区
- [ ] **Step 9:** commit `chore: react skeleton, dev standards, changelog, asset candidates`

### Task 2: Vendor Glin UI 组件（registry 抓取）

**Files:**
- Create: `web/scripts/vendor-glinui.mjs`（本地脚本，不引第三方执行）
- Create: `web/src/components/glinui/components/*.tsx`、`web/src/components/glinui/lib/*.ts`、`web/src/components/glinui/lib/cn.ts`
- Create: `web/src/components/glinui/manifest.md`
- Modify: `web/package.json`（补装各 item 的 npm 依赖）

**Interfaces:**
- Produces: 所有 UI 任务从此处 import：`import { Button } from '@/components/glinui/components/button'` 风格（tsconfig paths `@/*` → `src/*`）。组件名 = 导出符号 PascalCase（Button、GlassDock、GlassNavbar、GlassBreadcrumb、Table、TableHeader…、Modal+ModalContent…、Pagination、ContextMenu+全套、Command、Sheet…、Toast/Sonner、Progress、Checkbox、Tree、Empty、Attachment、CodePanel、Message、MessageScroller、Bubble、PromptInput、Thinking、FloatingPanel、AuroraBackground、DotPattern、BlurFade、Skeleton、Spinner、Avatar、Badge、DropdownMenu 全套、AlertDialog 全套、Field、Label、Input、Textarea? （无则自建）、Separator、Kbd、Tooltip、Alert、Heading、Text、ScrollArea、GlassCard 全套、LiquidButton）
- 若某组件与 barrel 已知不同：以 item JSON 的 `files[].content` 为准

- [ ] **Step 1:** 写 `vendor-glinui.mjs`：输入 item 名单 → BFS `registryDependencies` 闭包 → 逐 item GET `https://glinui.com/r/items/<name>.json`（超时 15s、重试 5 次）→ `files[].path` 里 `packages/ui/src/components/*` 映射到 `components/`、`packages/ui/src/lib/*` 映射到 `lib/`，加来源头注释；同时收集 `dependencies` 并集打印
- [ ] **Step 2:** 名单（spec §3/§5 全量）：`glass-dock glass-navbar glass-breadcrumb table pagination context-menu command modal sheet dropdown-menu tooltip toast input field label button checkbox progress tree empty attachment code-panel message message-scroller bubble prompt-input thinking floating-panel aurora-background dot-pattern blur-fade scroll-area skeleton spinner alert alert-dialog avatar badge separator kbd heading text glass-card` 跑脚本；`npm i <并集依赖（去 react 系与已装项）>`；把 `Textarea` 列入名单单独抓一次（spec §5.3 问答多行输入需要；若注册表无此 item 记录到 manifest 偏差，Task 12 用 PromptInput）
- [ ] **Step 3:** 手写 `lib/cn.ts`（clsx + tailwind-merge 的 `export function cn(...inputs: ClassValue[])`）——注册表 item 假定它存在但从未随 item 下发
- [ ] **Step 4:** 冒烟：临时把 `src/App.tsx` 改为渲染 GlassDock+GlassCard+Button+Table 各一次；`npm run build` 零错误即 vendor 结构正确；随后恢复占位 App
- [ ] **Step 5:** 写 `manifest.md`：组件清单、取回日期、每个组件的 npm 依赖、任何缺失/偏差记录（供 §11 兜底追溯）
- [ ] **Step 6:** changelog 行 + commit `feat: vendor glinui components from registry`

### Task 3: API 层、auth store、lib 工具（含错误映射全量移植）

**Files:**
- Create: `web/src/api/client.ts`、`auth.ts`、`storage.ts`、`knowledge.ts`
- Create: `web/src/stores/auth.ts`（zustand）
- Create: `web/src/lib/format.ts`
- Test: `web/src/api/client.test.ts`、`web/src/stores/auth.test.ts`、`web/src/lib/format.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { constructor(message: string, readonly status: number) }`
  - `request<T>(path: string, init?: RequestInit, token?: string): Promise<T>`（行为同旧版：非 JSON 错误兜底、204→undefined、401 时调用 `unauthorizedHandler`）
  - `setUnauthorizedHandler(fn: () => void): void`（解耦循环依赖，Task 4 注册路由跳转）
  - `translateError(raw: string, status: number): string`（导出以便测试；条目逐条对照旧 `web/src/api/client.ts:43-71` 移植，含 413/507 两条在 FileWorkbench 本地处理的文案并入：「文件过大，单次上传约支持 50 MiB 以内的文件。」「云仓可用存储空间不足。」）
  - auth：`useAuth`（zustand store：`{token, expiresAt, user}`）+ `authActions.setSession(token, expiresAt, user)` / `clear()` / `isAuthenticated(s): boolean` + `getToken(): string`（api 层非 hook 读取）；sessionStorage 三键名与旧版逐字节一致
  - `formatBytes(n: number): string`（"1.2 GB" 风格，同旧版展示）、`formatDate(iso: string): string`（本地日期 YYYY-MM-DD）
  - storage.ts 全部 21 个函数签名 = 旧版同名函数（`web/src/api/storage.ts` 逐行移植；`token()` 改从新 auth 读）
- Consumes: Task 1 骨架

- [ ] **Step 1: 写失败测试** `client.test.ts`：`translateError` 关键映射表驱动测试（≥12 条代表性原文→中文对，含 409 兜底）；`request` 用 `vi.stubGlobal('fetch', ...)`：①非 2xx JSON error 体 → 抛映射后中文 ApiError；②401 带 token → `unauthorizedHandler` 被调用一次（**Review Focus #1 上半**）；③204 → resolve undefined；④fetch reject → ApiError status 0「无法连接到服务，请确认 Go 后端已启动。」
- [ ] **Step 2: 写失败测试** `auth.test.ts`：setSession 写入三键、`isAuthenticated` 过期为 false、restore 过期键自动清除；`format.test.ts`：0/B/MB/GB 边界
- [ ] **Step 3:** 运行 vitest 确认上述失败（模块不存在）
- [ ] **Step 4:** 实现四个 api 文件 + auth store + format（storage.ts 的 `fetchTextPreview` 流式截断与 `downloadFile` 锚点法原样移植；`fileContentResponse` 401 分支同样走 `setUnauthorizedHandler`）
- [ ] **Step 5:** `npm test -- --run` 全绿；`npm run build` 零错误
- [ ] **Step 6:** changelog 行 + commit `feat: port api layer, auth store and utils with error i18n`

### Task 4: 路由、Provider、主题与 401 接线

**Files:**
- Create: `web/src/routes/index.tsx`（route objects）、`web/src/routes/guard.ts`、`web/src/providers/AppProviders.tsx`、`web/src/providers/theme.tsx`、`web/src/routes/LoginRoute.tsx`（占位）、`web/src/routes/AppLayout.tsx`（占位：Outlet+背景层）
- Test: `web/src/routes/guard.test.ts`

**Interfaces:**
- Produces: `canAccess(meta: {requiresAuth?: boolean; guestOnly?: boolean}, authed: boolean): true | '/login' | '/'`（纯函数）；`useTheme(): {theme:'dark'|'light', toggle(): void}`，`.dark` 挂 `<html>`，localStorage `acs.theme`；`<AppProviders>` = QueryClientProvider + ThemeProvider + RouterProvider + `<Toaster position="top-right">`；路由表：`/login`(guestOnly)、`/files`(requiresAuth)、`/trash`(requiresAuth)、`/`→`/files`、`*`→`/files`
- Consumes: `useAuth`/`authActions`（Task 3）；Task 4 内注册 `setUnauthorizedHandler(() => { authActions.clear(); toast('登录已过期'); navigate('/login') })`——在 AppLayout 挂载效应里注册，返回时反注册

- [ ] **Step 1:** 失败测试 `guard.test.ts`：requiresAuth+未登录→'/login'；guestOnly+已登录→'/'；其余 true
- [ ] **Step 2:** 实现守卫（router `beforeLoad` 用 `canAccess(to.meta, isAuthenticated(useAuth.getState()))`）+ providers + AppLayout（含 aurora-background+dot-pattern 固定背景层，vendored 组件）+ main.tsx 挂 AppProviders
- [ ] **Step 3:** 401 接线单测：模拟 `request` 401 → store 清空 +（在 jsdom 渲染的 AppLayout 中）路径变 `/login` 且 toast DOM 存在（**Review Focus #1 收口**）
- [ ] **Step 4:** `npm run build && npm test -- --run`；dev 手测：主题切换持久化、刷新后保持；changelog + commit `feat: routing, providers, theme, unauthorized wiring`

### Task 5: 登录页

**Files:**
- Create: `web/src/features/auth/LoginForm.tsx`、改写 `web/src/routes/LoginRoute.tsx`
- Test: `web/src/features/auth/login-flow.test.tsx`

**Interfaces:**
- Produces: 登录成功 → `authActions.setSession(...login 响应字段)` → `navigate('/files')`；失败 → Field 下方 `Alert`（destructive）显示 `ApiError.message`；限流原文命中「too many login attempts」时文案含等待时长（来自 translateError）
- Consumes: `login()`、vendored Field/Input/Button/Alert/GlassCard、土拨鼠 hero（`/images/cloud-gopher-pixel.png`，Task 1 已定）

- [ ] **Step 1:** 失败测试（testing-library + mock `login`）：成功路径写入会话并跳转；失败路径断言中文错误可见、不跳转；按钮 pending 态禁重复提交
- [ ] **Step 2:** 实现布局：全屏 aurora + 居中 GlassCard（宽 ≤420px）：mascot 图（64-80px，blur-fade 入场）、`Heading`「Agent 云仓」、Field 邮箱/密码、Button variant=liquid「登录」；小字注册提示「注册暂未开放」
- [ ] **Step 3:** 全绿 + dev 手测（错误密码中文提示、成功进 /files）；changelog + commit `feat: login page`

### Task 6: 外壳（navbar+dock）、面包屑祖先解析 + 后端 quota_bytes

**Files:**
- Create: `web/src/components/app/Dock.tsx`、`web/src/components/app/TopBar.tsx`、`web/src/features/files/crumbs.ts`、`web/src/lib/brand.ts`（BrandMark 用 Task 1 选定素材）
- Modify: `web/src/routes/AppLayout.tsx`（挂 TopBar/Dock/Outlet）
- Modify（Go）: `internal/file/repository.go`（Repository 接口 +`QuotaBytes(ctx, ownerID) (int64, error)`）、`internal/file/gorm_repository.go`（实现：`Table("users").Where("id=?",ownerID).Select("quota_bytes").Row().Scan`，风格同 `UsedBytes` 246 行）、`internal/file/service.go`（`StorageUsageResult` +`QuotaBytes int64`；`StorageUsage` 401-408 行双查）、`internal/httpapi/file_handler.go`（response struct 27 行 + 628 行 JSON 各加 `QuotaBytes int64 json:"quota_bytes"`）；service 测试内 fake repo 若存在实现旧接口，补桩方法
- Test: `web/src/features/files/crumbs.test.ts`；Go：`go test ./internal/file/...`（如已有 handler/service 测试覆盖 usage 则加断言，否则新增一例 service 测试断言 QuotaBytes 透传）

**Interfaces:**
- Produces: `type Crumb = { id: number; name: string }`；`resolveAncestorPath(folderId: number, queryClient): Promise<Crumb[]>`：优先读缓存的导航链（`['navTrail']`），未命中则自根 BFS `listFolders` 定位 parent 链（个人量级；5 min staleTime），失败 catch → `[{ id: folderId, name: '' }]` 且由调用方从当前列表数据补名（**Review Focus #3**）；`DockActions = { onUpload(): void; onSearch(): void; onNewFolder(): void }` 由 Task 8/9 注入实现，本任务先以 noop+TODO 渲染；Dock 条目：全部文件(Home)/回收站(Trash2)/搜索(Command)/上传(Upload)/新建(FolderPlus)/主题(SunMoon)/退出(LogOut，经 Avatar DropdownMenu)
- Consumes: glass-dock/glass-navbar/glass-breadcrumb/progress（右上角显示 `formatBytes(used) / formatBytes(quota)` + Progress 百分比）

- [ ] **Step 1:** 失败测试 `crumbs.test.ts`：mock listFolders 树（0→1→3→9）：缓存命中直返；冷启动 BFS 正确链；某层接口 reject 时降级单元素（**Review Focus #3 钉死**）
- [ ] **Step 2:** 实现 crumbs（含 `['navTrail']` 写入：Task 7 导航时更新）与 TopBar/Dock；files 路由把 `?folder=` 同步给面包屑
- [ ] **Step 3:** Go 侧改动 + 测试，`go build ./... && go test ./...` 全绿；curl `/api/v1/storage/usage` 手测含 `quota_bytes`
- [ ] **Step 4:** 前端 usage 条接通；dev 手测深链刷新 `?folder=3` 面包屑正确；changelog + commit `feat: app shell, breadcrumbs resolution, usage quota field`

### Task 7: 文件列表（浏览/分页/搜索）

**Files:**
- Create: `web/src/features/files/FilesTable.tsx`、`FilesPage.tsx`、`useFileRows.ts`、`web/src/routes/FilesRoute.tsx`
- Test: `web/src/features/files/useFileRows.test.ts`

**Interfaces:**
- Produces: `mergeRows(folders: FolderItem[], files: FileItem[], total: number): FileRow[]` 纯函数（文件夹前置、类型标注、`formatBytes/formatDate` 已格式化；`FileRow = { kind:'folder'|'file'; id; name; ... }`）；`useFileRows(folderId, page, keyword|null)` 封装三 query 合并 loading/empty 态；`FileRow` 供 Task 9/10/12 复用；导航点击 → `?folder=` 更新 + `navTrail` 追加
- Consumes: table/pagination/checkbox/empty/skeleton（vendored）、`['files',f,p]`/`['folders',f]`/`['search',q,p]` keys

- [ ] **Step 1:** 失败测试 mergeRows：顺序、文件夹优先、空态判定、关键词模式忽略文件夹前置
- [ ] **Step 2:** 实现行渲染（双击行 → `onPreview(row)` prop 传出，Task 10 接；右键 → `onContext(row, pos)`，Task 9 接；勾选集合状态上抛 `onSelectionChange`）、分页条（服务端 total）、搜索模式（TopBar 搜索框 keyword → search 查询，「N 个结果」计数）、骨架屏与 `Empty`+mascot
- [ ] **Step 3:** 全绿 + dev 手测（翻页、前进后退、搜索、空目录）；changelog + commit `feat: files list with pagination and search`

### Task 8: 上传（编排 lib + 直传/分片/续传/队列/拖拽）

**Files:**
- Create: `web/src/lib/uploads.ts`、`web/src/components/app/UploadQueuePanel.tsx`、`web/src/components/app/DropOverlay.tsx`、`web/src/features/files/useUploadManager.ts`
- Test: `web/src/lib/uploads.test.ts`

**Interfaces:**
- Produces:
  - `type UploadTask = { id: string; name: string; size: number; percent: number; status: 'queued'|'uploading'|'merging'|'done'|'failed'|'cancelled'; error?: string }`
  - `runUpload(file: File, folderID: number, deps: UploadDeps, onTask(t: UploadTask): void): Promise<void>`；`UploadDeps = { uploadFile; startMultipart; getProgress; uploadPart; complete; cancel; storage: { read(): SavedUpload[]; save(r: SavedUpload): void; forget(id: string): void }; signal: AbortSignal; partConcurrency?: number /*默认 3*/ }`
  - 逻辑=旧版 uploadFiles/uploadLargeFile 逐分支移植：≥49MiB 阈值、续传匹配四字段、progress.status 2/3/4 分支、**合并阶段忽略取消**（旧 544 行）、取消时 cancel+forget、失败抛原始 ApiError；分片循环改为并发 3（已传集合去重，失败即整任务 reject，保留续传记录）
  - `useUploadManager()`：多文件任务队列（文件级串行，队列并发 1；重试=以同一 File 重跑 runUpload）、Dock 上传钮与 DropOverlay 的入口、完成后 invalidate `['files']`+`['usage']`
- Consumes: storage.ts 上传函数、Attachment/Progress/FloatingPanel

- [ ] **Step 1:** 失败测试 `uploads.test.ts`（全部注入 fake deps，不碰网络）：①<49MiB 直传；②≥49MiB 完整 multipart 流程与 percent 单调；③已有可续传记录 → 仅补传缺失分片（**断言 uploadPart 调用次数=total-uploaded**）；④progress 404/409 → forget+全新 start（**Review Focus #2**）；⑤status=2 恢复合并；⑥merging 中 signal.abort 不中断 complete；⑦quota 507 → reject 且记录未 forget、可再跑成功（**Review Focus #5**）
- [ ] **Step 2:** 实现 uploads.ts → 全绿
- [ ] **Step 3:** 实现队列 UI + DropOverlay（dragenter/leave 计数防闪烁）+ Dock `onUpload` 接 input + DropOverlay 落点目录=当前 folder；搜索模式禁拖入（旧行为）
- [ ] **Step 4:** dev 手测：>49MiB 文件分片、中途关页面重开续传、取消；changelog + commit `feat: upload pipeline with resume, queue, drag-drop`

### Task 9: 操作集（新建/重命名/移动/删除/下载/右键/浮条）

**Files:**
- Create: `web/src/features/files/actions.ts`（invalidations 纯函数）、`MoveDialog.tsx`、`RenameDialog.tsx`、`RowToolbar.tsx`（选择浮条）、`RowContextMenu.tsx`
- Test: `web/src/features/files/actions.test.ts`

**Interfaces:**
- Produces: `computeInvalidations(action: { type:'create-folder'|'rename'|'move'|'trash'|'restore'|'perm-delete'; fromFolder?: number; toFolder?: number }, currentFolder: number): QueryKey[]`——**move 必须同时含源与目标目录 key + navTrail + usage**（**Review Focus #4**）；各对话框组件 props：`{ target: FileRow | FileRow[] | null; onClose(): void }`，内部 mutation 成功后 `toast` + invalidate；`RowToolbar` 出现条件 `selection.length>0`，含单选「问 AI」按钮（Task 12 前 disabled）
- Consumes: modal/tree/dropdown-menu/context-menu/alert-dialog；storage.ts 操作函数（永久删除=permanentlyDelete）；旧版限制文案（非空文件夹、自嵌移动）由 translateError 呈现

- [ ] **Step 1:** 失败测试 `actions.test.ts`：move 双目录失效、trash 含 usage、create-folder 含 folders+files key
- [ ] **Step 2:** 实现 `computeInvalidations` + 对话框/浮条/右键菜单接线（重命名规则前端不预判，全部交后端+中文映射；下载走 `downloadFile` 保留 emoji 文件名原样——锚点 `download` 属性直传 `original_name`）
- [ ] **Step 3:** 全绿 + dev 手测矩阵（右键/浮条各操作 + 移入空/非空/自身子目录三错误）；changelog + commit `feat: file actions, context menu, move tree dialog`

### Task 10: 预览 sheet

**Files:**
- Create: `web/src/features/files/PreviewSheet.tsx`、`web/src/features/files/preview-kind.ts`
- Test: `web/src/features/files/preview-kind.test.ts`

**Interfaces:**
- Produces: `previewKind(contentType: string, name: string): 'image'|'video'|'pdf'|'text'|'download-only'`（按扩展名+mime 双判；text 集合 = 旧版支持集：txt/md/json/code/... 以旧 FileWorkbench 判定逐条对照移植）；`PreviewSheet` props `{ row: FileRow | null; onClose(): void; onAsk(row): void }`，内容区按 kind 分支（image/video 原生标签 blob URL、pdf iframe、text `fetchTextPreview(…, 512*1024)` + CodePanel + 截断徽标），头部操作：下载、问 AI（>1MiB 或非 text 集合时禁用并 title 说明）、关闭
- Consumes: fetchFileContent/fetchTextPreview（Task 3）、sheet/badge/button；双击与右键「预览」入口（Task 7 已留 prop）

- [ ] **Step 1:** 失败测试 previewKind（各类型边界：无扩展名+octet→download-only；.md text；.mp4 video）
- [ ] **Step 2:** 实现；blob URL 在 unmount/row 切换时 `URL.revokeObjectURL`
- [ ] **Step 3:** 全绿 + dev 手测四类型 + 截断文本；changelog + commit `feat: preview sheet`

### Task 11: 回收站

**Files:**
- Create: `web/src/features/trash/TrashPage.tsx`、`web/src/routes/TrashRoute.tsx`
- Test: （复用 mergeRows 单测，无新纯逻辑；列出行为进手测清单）

**Interfaces:**
- Produces: 复用 `FilesTable`（列变体：删除时间、原目录名解析自 `navTrail` 缓存否则 `#<id>` 兜底）；行操作恢复/永久删除（`alert-dialog` 文案「永久删除后无法恢复」，成功后 invalidate trash+files+usage）
- Consumes: dock 回收站入口、`listTrash/restoreFile/permanentlyDelete`

- [ ] **Step 1:** 实现页面（分页、空态 mascot）+ 路由注册；`Empty` 文案与旧版一致
- [ ] **Step 2:** dev 手测：恢复→文件列表出现、永久删→用量条回落；changelog + commit `feat: trash page`

### Task 12: 文件问答 sheet

**Files:**
- Create: `web/src/features/qa/QaSheet.tsx`、`web/src/features/qa/qa-state.ts`
- Test: `web/src/features/qa/qa-state.test.ts`

**Interfaces:**
- Produces: `type QaTurn = { role:'user'|'assistant'; text: string; failed?: boolean }`；`appendTurn(list, turn)`、`canAsk(row: FileRow): { ok: boolean; reason?: string }`（text 集合且 ≤1MiB——判定复用 preview-kind；reason 中文）；`QaSheet` props `{ row: FileRow; open: boolean; onClose(): void }`：MessageScroller+Message/Bubble 列表、PromptInput（`maxLength 500` + 计数、IME-safe 由 vendored 组件保证、busy 时禁提交）、`thinking` 指示、`askFile` AbortSignal（关闭 sheet = abort）、500 错误显示「服务暂时遇到问题」并可重试上一条
- Consumes: message/message-scroller/bubble/prompt-input/thinking（Task 2 vendored）、knowledge.ts

- [ ] **Step 1:** 失败测试 canAsk/appendTurn（1MiB 边界、非 text 拒绝、失败轮重试不重复计入）
- [ ] **Step 2:** 实现 UI 接线（浮条「问 AI」与预览头部按钮从 disabled 转可用）
- [ ] **Step 3:** 全绿 + dev 手测（真问一次、中途关闭、500 重试）；changelog + commit `feat: file Q&A sheet`

### Task 13: 打磨、验收清单、性能与 bundle、部署演练

**Files:**
- Create: `web/src/components/app/GopherScene.tsx`（移植 `StorageScene.vue` 的 rAF 沿路径飞包 + prefers-reduced-motion 降级；静态 SVG 逐坐标搬运）
- Modify: 登录/空态接入 GopherScene；favicon（Task 1 选定素材）；`web/docs/13-react-rewrite-changelog.md` 追加「验收清单」节
- Test: 无新增单测；`npm run build` + 手工清单

- [ ] **Step 1:** GopherScene 移植 + favicon/品牌接线；`npm run build` 后记录 `dist/assets/*.js` gzip 体积（目标 <250KB，超标则按 manifest 精简未用 vendored 文件并记 changelog）
- [ ] **Step 2:** 性能验收：本地起 Go 后端+造 150 行数据，DevTools Performance 滚动 FilesTable 60s——无 >50ms 长任务堆积、dock hover magnify 流畅；结果截图/数值写进 changelog
- [ ] **Step 3:** 功能回归清单逐条手测（spec §6 全部端点 + Review Focus 5 项 + 旧版特有交互：拖拽上传、续传、合并中不可取消、搜索禁拖）——每条 PASS/FAIL+备注记入 changelog「验收清单」
- [ ] **Step 4:** **暂停点（用户批准）**：部署演练——按既有 bundle→scp→nginx 流程发一次预发/生产需用户明示同意；回滚路径=旧 dist 复原
- [ ] **Step 5:** changelog 终行 + commit `feat: brand scene polish, acceptance and deploy drill`；分支收尾走 superpowers:finishing-a-development-branch

---

## 自检记录（写计划后执行）

1. Spec 覆盖：§3 vendor→T2、§4 结构/路由→T1/3/4/6、§5.1→T5、§5.2→T6、§5.3→T7/8/9/10/12、§5.4→T11、§6→T3、§7.1→T1、§7.2→T1/13、§8→T13、§10-A→T6、用户新增两条（追踪文档/规范）→T1+Global Constraints。无遗漏。
2. 类型一致性：FileRow/Crumb/UploadTask/SavedUpload 跨任务引用已对齐；`getToken`/`useAuth` 统一出自 Task 3。
3. 步骤均可一步做完；无悬空 TBD。
