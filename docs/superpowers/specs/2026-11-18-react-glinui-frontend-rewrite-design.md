# 前端重写设计方案：React + Glin UI（液态玻璃）

日期：2026-11-18
状态：**最终版 v2.1**（全部决定已确认，可进入实施计划）
作者：Claude（与用户对话整理 + 独立评审员复核）

## 1. 意图与动机

现有 Vue 3 + Element Plus 前端的 **UI 设计与布局质量不满意**，且布局是主要痛点。决定用 React 重写整个前端，视觉方向为 Apple "液态玻璃"（Liquid Glass）风格，组件库采用 **Glin UI**（选型验证见 §3）。

2026-11-18 用户补充三条决定：

1. **导航布局采用底部 macOS 风 `glass-dock`**（放弃侧边栏方案）
2. **土拨鼠场景图保留**（`cloud-gopher-pixel.png`  mascot 图 + `StorageScene` 动画场景移植到 React）
3. **所有 logo/品牌素材禁止 AI 生成，必须采用网络上现存设计**（开放授权素材，来源与许可证登记在案）

后端仅一处微调（用户 2026-11-18 确认）：`/api/v1/storage/usage` 响应新增 `quota_bytes` 字段；其余功能逻辑**完全不动**。功能范围与现有前端 1:1 平移，不新增功能。

## 2. 目标 / 非目标 / 反目标

**目标**

- 现有功能与交互全部平移，包括：约 30 条后端错误的中文映射、登录限流提示、分片上传续传、文本预览截断等细节
- 视觉统一为 Glin UI 玻璃 token 体系，布局按 dock 形态**重新设计**（不是换皮）
- 性能合格：150+ 行文件列表滚动不掉帧；玻璃效果只用于"壳"层表面
- 全项目 TypeScript strict；构建产物为纯静态 `dist/`，兼容现有 nginx + bundle 部署流程（阿里云 8.148.23.240 / secplusplus.xyz，HTTPS 已启用）

**非目标**

- 不新增功能（分享链接、批量下载、多标签等一律不做）
- 不 AI 生成任何品牌/装饰图片资产
- 不建 E2E 测试基建（组件级测试按需）
- 移动端只求可用（dock/弹层自然响应），不做原生级体验
- 不长期保留 Vue/React 双前端并行维护

**反目标（技术上能跑但仍算失败）**

- 视觉上混入第二套组件体系（哪怕一个 Element-Plus 风格的控件）
- 逐行套 `backdrop-filter` 的"糊玻璃"导致列表不可读或卡顿
- 把旧布局原样搬到 React 里换皮——用户的痛点正是布局
- 使用了来源/授权不明的素材上线

## 3. 技术选型（已定）

| 决定 | 内容 | 归属 |
|---|---|---|
| 框架 | React 19 + Vite + TypeScript（strict） | 用户 |
| 组件体系 | **仅 Glin UI**（MIT），但采用 **registry 源码 vendor 模式**（见下）而非 `@glinui/ui` 运行时 npm 包 | 用户选库；vendor 模式为我的判断 |
| 样式 | Tailwind CSS v4（`@tailwindcss/postcss`）+ `@glinui/tokens/theme.css` | 从属选型 |
| 动效 | `@glinui/motion`（npm 可达） | 从属选型 |
| 服务器状态 | TanStack Query | 我的判断 |
| 客户端状态 | zustand（仅 auth 会话与少量 UI 状态） | 我的判断 |
| 路由 | react-router v7（data router，无 SSR） | 我的判断 |
| 图标 | lucide-react（MIT 开源设计，非 AI，符合素材规则） | 从属选型 |
| 品牌素材 | 只用网络现存设计 + 登记出处（见 §7.1）；现有土拨鼠 PNG 与 StorageScene 保留 | 用户 |
| 旧 Vue 代码 | 保留在 git 历史作迁移参考；骨架建立后删除 `glass-spike/` | 我的判断 |

**组件获取方式 = vendor 模式（关键决定，来自 2026-11-18 独立评审）**

评审发现 `@glinui/ui@0.1.1` npm 包只含 142 个组件中的 **78 个**；本项目需要的 `context-menu / pagination / attachment / empty / field / code-panel / prompt-input / message / message-scroller / bubble / thinking / gradient-text / glass-breadcrumb` 等 **13+ 个仅存在于 `glinui.com/r` 注册表**。同时：glinui.com 从本机需走代理才可达（已实测可取回完整 item JSON），从构建/部署环境（阿里云）基本不可达。

因此：**把用到的组件源码（含其依赖的 lib 文件与 registryDependencies）从注册表一次性取回，vendor 进 `web/src/components/glinui/`，逐文件头注释 registry 版本与取回日期**。此后开发、构建、部署均不再依赖 glinui.com；npm 依赖（Radix 子包、cva、sonner、cmdk 等）按每个 item 的 `dependencies` 字段补装，走可达的 npm registry。获取方式：手工 GET `glinui.com/r/items/<name>.json`（已在验证中跑通，绕开 CLI 执行）或用户自行运行 `npx glinui add`。

**已知妥协（用户已认可）**：Glin UI 是 CSS `backdrop-filter` 毛玻璃体系（token 按 Apple spec 调校、边缘高亮为渐变模拟），不是 SVG displacement 真折射；换来 Firefox/Safari 兼容与组件成套。

## 4. 工程结构与路由

在分支 `feat/react-glinui-rewrite` 上**原地替换 `web/`**（package.json、vite.config、src 全部换新；git 历史即备份）。

```
web/src/
  api/            # client.ts / auth.ts / storage.ts / knowledge.ts —— 移植旧逻辑（§6）
  routes/         # login / (app) 布局路由 / files / trash
  features/
    files/        # 列表、工具条、预览、上传队列、操作浮条、Q&A 面板
    trash/
    auth/
  components/
    glinui/       # vendor 的 Glin UI 源码（含 lib/，头注释来源）
    app/          # 自建件：DropOverlay、UploadQueuePanel、StorageMeter、GopherScene(移植)…
  providers/      # QueryClient、AuthProvider、Theme
  lib/            # cn、format(bytes/date)、error-i18n
  stores/auth.ts
```

- 路由：`/login`（guestOnly）、`/files?folder=<id>`（根目录 folder=0；文件夹状态入 URL，可刷新/前进后退）、`/trash`、通配重定向 `/files`
- **面包屑路径解析（我的判断，评审问题 3）**：应用内导航时把祖先链放进 TanStack Query 缓存（点击行为天然已知父链）；**深链/刷新**时执行一次"逐层下探收集全目录"（旧版移动对话框已有同款遍历，个人库量级可接受，缓存 5 分钟）；遍历失败降级为仅显示当前目录名
- 路由守卫与 401 行为照旧：token 失效 → 清会话 → 跳 `/login` → toast「登录已过期」

## 5. 页面设计（逐屏）

### 5.1 登录 `/login`

全屏 `aurora-background` + 居中 `glass-card` 登录表单（`field`/`input`/`label`，`liquid-button` 提交）。**卡片内 header 表单上方为土拨鼠 mascot 图（cloud-gopher-pixel.png）**（T13a 措辞钉死：原文「卡片上方」按 R(T5-mascot)「表单上方」精神落实现=卡内 header 区，实现不回改；卡片下部为 GopherScene 品牌场景带），`blur-fade` 入场。注册入口保持禁用（API 仍开放，同旧版产品决策）。错误走 `alert` + toast；限流错误显示等待时长文案。

### 5.2 应用外壳（AppShell）——底部 dock 布局（用户决定）

- **底部居中 `glass-dock`**（magnification 放大 + hover tooltip，macOS 手感）：
  - 导航区：`全部文件`（Home）、`回收站`、`搜索`（唤起 `command` 命令面板，走 files/search 接口）
  - 动作区（分隔线后）：`上传`（触发隐藏 file picker）、`新建文件夹`（modal）
  - 账户区（分隔线后）：`用户`（头像图标 → `dropdown-menu`：主题切换、退出登录）
- **顶部细条 `glass-navbar`**：左侧品牌（BrandMark + 应用名，§7.1），中间 `glass-breadcrumb` 路径，右侧存储用量 `progress` 条（已用 / `quota_bytes`，bytes 格式化）
- 固定背景层（`aurora-background` + `dot-pattern`），玻璃表面从它取折射模糊；内容区全宽，无侧边栏
- `toast`（sonner）全局挂载，位置右上（避开底部 dock）

### 5.3 文件工作台 `/files`

1. **工具条**（玻璃表面）：上传、新建文件夹、搜索框、每页 20 条服务端分页
2. **文件列表**：`table` 原语 + 外置 `pagination`（服务端分页 20/页，接口无排序参数，**不用 data-table 的客户端分页/排序**——我的判断）。文件夹与文件混排（文件夹前置，同旧版），行勾选（`checkbox`）
3. **选择态浮条**（floating `glass-card`，出现在 dock 上方）：下载 / 移动（`modal` + `tree` 目标目录）/ 重命名（`modal`）/ 移入回收站 /（单选文件时）`问 AI`

交互细节：

- 行右键 → `context-menu`（与浮条同操作集 + 预览）；双击 → 预览
- **预览**：右侧 `sheet`：图片/视频 `<img>/<video>`、PDF `<iframe>`、文本 `fetchTextPreview` 截断 + `code-panel` 展示并标注「已截断」；预览 sheet 头部含「问 AI」入口
- **拖拽上传**：全窗 `DropOverlay`（自建件，玻璃遮罩 + 土拨鼠图案）
- **上传队列**：右下浮层（`floating-panel`）：每任务一行（`attachment`）：进度、取消、失败重试、**续传**（progress 接口查已传分片）
- **文件问答**：右侧 `sheet`：`message-scroller` + `message`/`bubble` 对话流 + `prompt-input`（IME-safe Enter、`thinking` 指示、AbortSignal 取消）

### 5.4 回收站 `/trash`

同外壳。`table` + `pagination`（服务端分页）。行操作：恢复 / 永久删除（`alert-dialog` 确认，文案保留「永久删除后无法恢复」）。空态用 `empty` + 土拨鼠图。

## 6. API 层移植（1:1 清单）

`client.ts`：`request<T>` + `ApiError` + **`translateError` 全部约 30 条中文映射原样移植**（纯 TS，无 Vue 依赖）；401 → 清会话 + 路由跳转 + toast（去掉 `window.dispatchEvent`）。

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/v1/auth/login` | POST | 登录（JWT，expires_at） |
| `/api/v1/auth/register` | POST | 注册（前端禁用入口） |
| `/api/v1/files?folder_id&page&page_size` | GET | 文件列表（分页 20） |
| `/api/v1/files/search?q&page` | GET | 搜索 |
| `/api/v1/folders?parent_id` | GET | 子文件夹（面包屑遍历用） |
| `/api/v1/folders` | POST | 建文件夹 |
| `/api/v1/folders/{id}` | PATCH / DELETE | 重命名 / 删除（非空报错文案保留） |
| `/api/v1/folders/{id}/move` | PATCH | 移动文件夹（自嵌检测文案保留） |
| `/api/v1/files` | POST(FormData) | 单文件直传（≤50MiB） |
| `/api/v1/uploads` | POST | 分片会话创建 |
| `/api/v1/uploads/{id}` | GET / DELETE | 查询进度（续传）/ 取消 |
| `/api/v1/uploads/{id}/parts/{n}` | PUT | 传分片（AbortSignal） |
| `/api/v1/uploads/{id}/complete` | POST | 合并 |
| `/api/v1/files/{id}` | PATCH / DELETE | 重命名 / 移入回收站 |
| `/api/v1/files/{id}/move` | PATCH | 移动文件 |
| `/api/v1/files/{id}/content` | GET | 预览/下载共用（流式截断读取） |
| `/api/v1/files/{id}/restore` | POST | 恢复 |
| `/api/v1/trash?page` | GET | 回收站列表 |
| `/api/v1/trash/{id}` | DELETE | 永久删除 |
| `/api/v1/storage/usage` | GET | 已用字节；响应**新增 `quota_bytes`**（后端唯一改动，已确认） |
| `/api/v1/knowledge/ask` | POST | 文件问答（AbortSignal） |

分片上传策略不变：超 50MiB 走分片 → start → 按 `part_size` 切片 → 并发 3–4（旧版顺序上传，提速属布局重设计内的改良——我的判断）→ complete；失败任务凭 `uploaded_parts` 续传。

TanStack Query key：`['files',folderId,page]`、`['folders',parentId]`、`['trash',page]`、`['search',q,page]`、`['usage']`、`['crumbs',folderId]`；mutation 成功 → invalidate + toast。

## 7. 视觉、素材与性能策略

### 7.1 品牌与素材规则（用户决定）

- **禁止 AI 生成**任何 logo/品牌/装饰图片
- 新素材一律采用**网络现存设计**：开放授权图标/插画（lucide、simple-icons、OpenGameArt/itch.io CC0 像素包等）
- 每个采用的素材在 `web/docs/asset-credits.md` 登记：名称、来源 URL、作者、许可证（仅接受 MIT / ISC / CC0 / CC-BY，CC-BY 须署名）
- 保留并使用：`cloud-gopher-pixel.png`（登录 hero、空态、拖放遮罩）、`StorageScene.vue` 的 SVG 动画场景（移植为 React 组件 `GopherScene`，含 prefers-reduced-motion 逻辑）
- `BrandMark.vue` 内手绘 SVG 不作废旧版（用户可继续用），但**新的主 logo 以现存素材为准**，实施第 1 步完成候选筛选并交用户确认样式

### 7.2 视觉与性能

- **玻璃分层**：背景固定一层 → 内容滚动其上 → `backdrop-filter` 只用于 navbar、dock、卡片壳、浮层；**表格行不用 backdrop-filter**，用半透明底色
- 默认**暗色**主题，light/dark 切换持久化（`.dark` class，tokens 已支持）——我的判断
- bundle：vendor 模式天然只引入用到的组件；lucide 按需 import；目标 JS gzip < 250KB
- 验收测帧：1080p、150 行数据，DevTools Performance 滚动无长任务堆积

## 8. 迁移与回滚

1. 分支 `feat/react-glinui-rewrite`，按 §9 顺序实施
2. 本地 `vite build` + 静态 preview 过功能清单后走现有 bundle→scp→nginx 流程；nginx root 不变（`/opt/agentcloudstorage/web/dist`），替换即上线，回滚 = 重新部署旧 dist 或 git revert
3. 历史路由兼容：`/` → `/files`，`/trash` 不变

## 9. 实施顺序

1. **素材与骨架**：asset-credits 候选筛选（logo 交用户确认）→ Vite/React/Tailwind4/TanStack/router 骨架 → 从注册表 vendor 首批组件（button、input、glass-card、modal、table、dropdown-menu、dock、navbar、breadcrumb、toast 等）+ 依赖补装 → api 层移植（含全部错误映射）与 auth store
2. 登录页（土拨鼠 hero）
3. 外壳（dock + navbar + 面包屑解析）+ 文件列表（浏览/分页/搜索）；含后端 `quota_bytes` 一处改动
4. 上传（直传 + 分片 + 队列 + 拖拽 + 续传）
5. 操作集（建/改名/移动/删除 + context-menu + 选择浮条）
6. 预览 sheet + 下载
7. 回收站
8. 文件问答 sheet（message 流 vendoring）
9. 视觉打磨（GopherScene 移植、空态、骨架屏）+ 性能测帧 + 部署演练

## 10. 决定记录与遗留问题

**已决（用户，2026-11-18）**：底部 `glass-dock` 导航；土拨鼠场景图保留；logo/素材不 AI、取网络现存设计；接受毛玻璃（非真折射）视觉体系；组件库 = Glin UI（vendor 获取方式为实现细节，归我的判断）。

**已决（用户，2026-11-18，原遗留问题）**：存储用量显示取方案 A——`storageUsageResponse` 增加 `quota_bytes`（来自 users 表配额列），前端画完整容量条。后端配套改动仅此一处（handler + 相应测试），列入 §9 第 3 步。

## 11. 留给实施者的自由度

- 组件 props 级样式微调（surface variant：glass/liquid/matte/outline 搭配）
- dock 具体条目顺序与图标选型（lucide 内）
- **vendor 组件源码若不可用/有缺陷：自建等效件或替换实现，不需另行批准**（评审问题 1 的兜底；须在 asset-credits 同级 README 记录偏离）
- 自建件 DOM 结构（DropOverlay、UploadQueuePanel）
- 测试策略（推荐 vitest 覆盖 lib/ 与 api/）；代码分割粒度（懒加载 trash/问答）
