# 布局密增三件套（A 密度 / B 详情面板 / C 首页仪表盘）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 消除前端"显空"观感：内容宽度与行密度（A）、选中行右栏详情面板（B）、根目录"最近添加 + 存储环"仪表盘带（C）。

**Architecture:** 全部为布局/呈现层改动，复用既有数据与动作（零新请求、零新端点、后端不动）；A 改容器与表格形态，B 在 A 的内容列上挂右栏，C 在 FilesPage 根目录态顶部插一条带。

**Tech Stack:** 既有栈（React19/vendored Glin UI/Tailwind4/lucide-react）；不新增任何第三方依赖。

**Spec:** 母设计 docs/superpowers/specs/2026-11-18-react-glinui-frontend-rewrite-design.md（本轮为其 §7.2/§5.3 的布局精化；仪表盘带判为布局层、不违"不新增功能"——数据全来自现有 ['files',0,1]/['usage'] 缓存）

## Global Constraints

- 分支：**直接在 main 上开新分支 `feat/layout-density-abc`**（base 53268c8；用户已合并上一轮，惯例同前：完成评审后合回）
- 零新依赖、零新 API 调用、后端不动；vendored `components/glinui/` 只准消费不准改（standards §vendor）
- 新增/改动组件遵守 `web/docs/12-react-rewrite-development-standards.md`（PascalCase 组件/kebab 模块、tokens 配色、错误走 ApiError.message）
- 每任务：changelog 行（六列，显式 SHA 区间）+ conventional commits + 只 add web/ 路径；绝不 add .superpowers/、deploy/、cmd/、根 .gitignore
- 门：全量测试绿（当前 298）pristine；`npm run build` 0 错误；gzip < 250KB
- 矩阵纪律：每任务的 C 组新增验收行写进 changelog「验收清单」（标 待测），交付时并入用户浏览器回填
- 验收基线（A）：1440px 屏内容列 ≥1360px 可用宽；行有图标锚点；列表内部滚动、表头吸顶

---

### Task 1 (A): 密度与节奏（宽度 / 行图标 / 容器滚动 / 间距）

**Files:**
- Modify: `web/src/features/files/FilesPage.tsx`、`web/src/features/trash/TrashPage.tsx`（容器 `max-w-5xl → max-w-[1440px]`，`gap-4 → gap-3`）
- Modify: `web/src/routes/AppLayout.tsx`（main `p-6 → p-4`；`pb-28` 保留给 dock，但列表改内滚后不再叠加留白感知）
- Modify: `web/src/features/files/FilesTable.tsx`（行首图标列 + `stickyHeader` + `containerClassName` 内滚 max-h；TrashPage 侧同款行组件复用或共享 icon 逻辑）
- Create: `web/src/lib/file-icons.ts`（`fileIcon(name: string, contentType: string): LucideIcon`；文件夹=Folder，图=FileImage，视频=FileVideo，音频=FileAudio，压缩包=FileArchive，代码/文本=FileCode，pdf=FileText，其余=File；ext 解析复用 preview-kind 的取名法）
- Test: `web/src/lib/file-icons.test.ts`、既有 files-page/trash-page 测试更新

**Interfaces:**
- Produces: `fileIcon(name, contentType) → LucideIcon`（纯函数，B 详情面板复用大图标）
- Consumes: vendored `icon-frame`（先读 .d.ts 再 import；不存在则 span+tokens 包一层并记 manifest 式注释）、lucide-react（已装）

- [ ] Step 1: RED：file-icons 表驱动测试（每类至少 1 例 + 无扩展名/大写扩展名/octet mime 兜底）
- [ ] Step 2: 实现 file-icons.ts → GREEN
- [ ] Step 3: FilesTable 行首图标（icon-frame 托底、type-variant 色走 tokens；文件夹/文件图标区分可见），开启 `stickyHeader`，容器 `max-h-[calc(100vh-260px)] overflow-y-auto`（常量提为变量注释说明扣减构成：顶栏+标题行+工具条+dock 带）；FilesPage/TrashPage 容器与间距类名替换
- [ ] Step 4: 更新受影响的行断言测试（行结构加了图标节点；搜索副标题/选择/键盘入口不得回归）；全量 298+ 绿、build 0、gzip 记录
- [ ] Step 5: changelog 行 + 矩阵新增 2 行（A-宽屏密度目测、内滚吸顶手感）→ commit

### Task 2 (B): 选中行右栏详情面板

**Files:**
- Create: `web/src/features/files/DetailPanel.tsx`（+ 测试 `detail-panel.test.tsx`）
- Modify: `web/src/features/files/FilesPage.tsx`（内容列 → `lg` 起双栏：主列表 flex-1 + 右 aside ~340px；selection 派生）
- Modify: `web/src/features/trash/TrashPage.tsx`（同款 aside：操作=恢复/永久删除预览？裁定：**trash 侧仅展示元数据+恢复按钮，不给永久删除**（防误触，面板非确认渠道）；写进测试）

**Interfaces:**
- Consumes: FilesPage 现有 selection 状态、`fileIcon`、openPreview/rename/move/trash 既有动作函数（**必须复用，不得 fork 第二套 mutation**）、canAsk、`searchSourceLabel`/navTrail 缓存显示所在目录
- Produces: `<DetailPanel rows selectionMeta onAction… />` 纯呈现 + 回调 props；单行=图标大号+名称+类型/大小/时间/所在目录+动作钮组（预览/下载/重命名/移动/问 AI；不可用置灰带 reason 同 ⑮ 模式）；多行=计数摘要+批量（下载/移入回收站）；无选中=不渲染 aside（grid 回单栏）；关闭钮=清空选择

- [ ] Step 1: RED：detail-panel 测试（单行渲染字段齐全、动作点击回调断言、多行摘要、无选中不渲染、trash 模式无永久删除钮、<lg hidden 类）
- [ ] Step 2: 实现组件与两页接线（选中变化→面板出现；行点击单选语义与现有 checkbox 共存：checkbox 管多选、单击行名仍走预览/进入目录不变；**单击空白名区不劫持**——面板数据源仍是 checkbox selection）
- [ ] Step 3: 全量绿 + build；矩阵 +2 行（面板动作走查、窄屏隐藏）
- [ ] Step 4: changelog + commit

### Task 3 (C): 根目录仪表盘带（最近添加 + 存储环）

**Files:**
- Create: `web/src/features/files/RecentStrip.tsx`（+ 测试）、纯逻辑 `recentCards(files: FileItem[], limit = 6)` 与 `usagePercent(used, quota): number` 入同文件或 lib
- Modify: `web/src/features/files/FilesPage.tsx`（`folderId===0 && !keywordMode` 时列表上方渲染；数据=已缓存的 ['files',0,1] 文件行按 created_at（服务端已 DESC 排序，直接取前 N）+ ['usage']）

**Interfaces:**
- Produces: 卡片=icon（fileIcon）+ 名称 + 相对时间（lib/format 若缺 relative 则在 C 内加 `formatRelative(iso)` 纯函数，中文「今天/昨天/N 天前/日期」，表驱动测试）；点击卡片=openPreview(row) 同缝；存储环=ProgressCircle（先核 .d.ts 有则用，无则 tokens conic-gradient div + TODO 注释，同 manifest 纪律）
- Consumes: A 的 file-icons、既有 queries；**零新请求**（用 queryClient.getQueryData 读取已有缓存即可，无则等既有 query 落定）

- [ ] Step 1: RED：recentCards（<49MiB 大杂烩页 1 取前 6、文件夹不混入、created_at 已序不重排断言）、usagePercent（0/半/满/quota=0 除零）、formatRelative 边界
- [ ] Step 2: 实现 + 接线（仪表盘带出现即占用首屏：内滚容器 max-h 扣减值同步调整——提常量，避免两套魔法数）
- [ ] Step 3: 全量绿 + build（gzip 记录，仍 <250KB）；矩阵 +2 行（根目录首屏仪表盘、非根/搜索态不出现）
- [ ] Step 4: changelog + commit（含「本轮交付摘要」行）

---

## Self-review 记录
- 覆盖核对：用户三诉求 A/B/C 各自成任务；无新功能、无后端、无依赖（与母 spec 约束自洽）；B 复用 A 的 fileIcon、C 复用 A/B 的既有 query 缓存——接口链 A→B→C 单向，串行执行。
- 风险：FilesTable 行结构变化牵动 T7-T13 既有断言（A Step 4 显式处理）；内滚容器与 dock/RowToolbar 浮层的 z-index/滚动交互留浏览器矩阵验证。
