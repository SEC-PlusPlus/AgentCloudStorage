# 前端重写设计方案：React + Glin UI（液态玻璃）

日期：2026-11-18
状态：待用户确认遗留问题（见文末）
作者：Claude（与用户对话整理）

## 1. 意图与动机

现有 Vue 3 + Element Plus 前端的 **UI 设计与布局质量不满意**，且布局是主要痛点。决定用 React 重写整个前端，视觉方向为 Apple "液态玻璃"（Liquid Glass）风格，组件库采用 **Glin UI**（验证见 §3）。

后端（Go API、MySQL/MinIO/Redis、部署链路）**完全不动**。功能范围与现有前端 1:1 平移，不新增功能。

## 2. 目标 / 非目标 / 反目标

**目标**

- 现有功能与交互全部平移，包括：约 30 条后端错误的中文映射、登录限流提示、分片上传续传、文本预览截断等细节
- 视觉统一为 Glin UI 玻璃 token 体系，布局**重新设计**（不是换皮）
- 性能合格：150+ 行文件列表滚动不掉帧；玻璃效果只用于"壳"层表面
- 全项目 TypeScript strict；构建产物为纯静态 `dist/`，兼容现有 nginx + bundle 部署流程（阿里云 8.148.23.240 / secplusplus.xyz，HTTPS 已启用）

**非目标**

- 不新增功能（分享链接、批量下载、多标签等一律不做）
- 不建 E2E 测试基建（组件级测试按需）
- 移动端只求可用（dock/sheet 自然响应），不做原生级体验
- 不长期保留 Vue/React 双前端并行维护

**反目标（技术上能跑但仍算失败）**

- 视觉上混入第二套组件体系（哪怕一个 Element-Plus 风格的控件）
- 逐行套 `backdrop-filter` 的"糊玻璃"导致列表不可读或卡顿
- 把旧布局原样搬到 React 里换皮——用户的痛点正是布局

## 3. 技术选型（已定）

| 决定 | 内容 | 归属 |
|---|---|---|
| 框架 | React 19 + Vite + TypeScript（strict） | 用户 |
| 组件库 | **仅 Glin UI**：`@glinui/ui`（npm v0.1.1，MIT，142 组件，内含 Radix/sonner/cmdk/lucide）+ `@glinui/tokens`（Tailwind 4 主题）+ `@glinui/motion` | 用户 |
| 样式 | Tailwind CSS v4（`@tailwindcss/postcss`），不手写全局 CSS 体系 | 从属选型 |
| 服务器状态 | TanStack Query | 我的判断 |
| 客户端状态 | zustand（仅 auth 会话与少量 UI 状态） | 我的判断 |
| 路由 | react-router v7（data router，无 SSR） | 我的判断 |
| 图标 | lucide-react（Glin UI 自带依赖，不另装图标库） | 从属选型 |
| 旧 Vue 代码 | 保留在 git 历史作迁移参考；正式骨架建好后删除 `glass-spike/` 验证目录 | 我的判断 |

**选型依据（2026-11-17/18 实测）**：npm registry 数据、glinui.com/r 注册表 142 组件清单、`glass-spike/` 最小验证（安装、`tsc` 零错、`vite build` 通过）。

**已知妥协（用户需知晓，见 §10）**：Glin UI 是 CSS `backdrop-filter` 毛玻璃体系（token 按 Apple spec 调校、边缘高亮为渐变模拟），**不是** SVG displacement 真折射（`liquid-glass-react` 那条路线）。换来的是 Firefox/Safari 兼容与组件成套。

## 4. 工程结构

在分支 `feat/react-glinui-rewrite` 上**原地替换 `web/`**（package.json、vite.config、src 全部换新；git 历史即备份）。

```
web/src/
  api/            # client.ts / auth.ts / storage.ts / knowledge.ts —— 移植旧逻辑（见 §6）
  routes/         # login / (app) 布局路由 / files / trash
  features/
    files/        # 列表、工具条、预览、上传队列、Q&A 面板
    trash/
    auth/
  components/     # 少量自建件：DropOverlay、UploadQueuePanel、StorageMeter…
  providers/      # QueryClient、AuthProvider、Theme
  lib/            # cn、format(bytes/date)、error-i18n
  stores/auth.ts
```

- 路由：`/login`（guestOnly）、`/files?folder=<id>`（默认根目录 folder=0，文件夹状态入 URL，可刷新/前进后退）、`/trash`、通配重定向 `/files`
- 路由守卫与 401 行为照旧：token 失效 → 清会话 → 跳 `/login` → toast「登录已过期」

## 5. 页面设计（逐屏）

### 5.1 登录 `/login`

全屏 `aurora-background` + 居中 `glass-card` 登录表单（`field`/`input`/`label`，`liquid-button` 提交）。注册入口保持禁用（API 仍开放，产品决策同旧版）。错误走 `alert` + toast；限流错误显示等待时长文案。

### 5.2 应用外壳（AppShell）

- **导航形态：左侧 `sidebar`（可折叠成 icon rail，Ctrl/Cmd+B，状态持久化）**——我的判断，备选形态 `glass-dock` 底部坞，见 §10
- 顶部 `glass-navbar`：面包屑（`glass-breadcrumb`）、全局搜索入口（`command` 命令面板式，走 `files/search` 接口）、主题切换（`glass-toggle`）、用户菜单（`dropdown-menu`：登出）
- 固定背景层（`aurora-background` + `dot-pattern`），玻璃表面从它取折射模糊
- `toast`（sonner）全局挂载；`Toaster` 位置右下

### 5.3 文件工作台 `/files`

主体三行式：

1. **工具条**（玻璃表面）：上传按钮（含拖拽）、新建文件夹（`modal`）、搜索框（`input`）、右侧 `storage-usage` 进度条（`progress`，bytes 格式化）
2. **文件列表**：`table` 原语 + 外置 `pagination`（**服务端分页 20/页，接口无排序参数，故不用 data-table 的客户端分页/排序**——我的判断）。文件夹与文件混排（文件夹前置，同旧版）。行内勾选（`checkbox`）
3. **选择态浮条**（floating `glass-card`）：下载 / 移动（`modal` + `tree` 选目标文件夹）/ 重命名（`modal`）/ 移入回收站

交互细节：

- 行右键 → `context-menu`（同上浮条操作 + 预览）；双击 → 预览
- **预览**：`sheet`（右侧滑出）承载：图片/视频直接 `<img>/<video>`、PDF `<iframe>`、文本走 `fetchTextPreview` 截断 + `code-panel` 样式展示，标注「已截断」
- **拖拽上传**：全窗 `DropOverlay`（自建件，玻璃遮罩）
- **上传队列**（右下浮层，`floating-panel` 或 `card`）：每任务 `attachment` 行（进度、取消、失败重试、**续传**——复用旧版 progress 接口查询已传分片）
- **文件问答**：列表选中单文件时，`glass-dock` 风格悬浮按钮唤起右侧 `sheet`：`message-scroller` + `message`/`bubble` 对话流 + `prompt-input` 输入（IME-safe Enter、AbortSignal 取消、`thinking` 指示）。旧版为内嵌面板，新版改抽屉属布局重设计

### 5.4 回收站 `/trash`

同外壳。`table` + `pagination`（服务端分页）。行操作：恢复 / 永久删除（`alert-dialog` 确认，文案保留「永久删除后无法恢复」）。空态用 `empty`。

## 6. API 层移植（1:1 清单）

`client.ts`：`request<T>` + `ApiError` + **`translateError` 全部约 30 条中文映射原样移植**（纯 TS，无 Vue 依赖）；401 → 清会话 + 全局事件 → 路由跳转（EventEmitter 改为 zustand action，去掉 `window.dispatchEvent`）。

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/v1/auth/login` | POST | 登录（JWT，expires_at） |
| `/api/v1/auth/register` | POST | 注册（前端禁用入口） |
| `/api/v1/files?folder_id&page&page_size` | GET | 文件列表（分页 20） |
| `/api/v1/files/search?q&page` | GET | 搜索 |
| `/api/v1/folders?parent_id` | GET | 子文件夹 |
| `/api/v1/folders` | POST | 建文件夹 |
| `/api/v1/folders/{id}` | PATCH / DELETE | 重命名 / 删除（非空报错文案保留） |
| `/api/v1/folders/{id}/move` | PATCH | 移动文件夹（自嵌检测文案保留） |
| `/api/v1/files` | POST(FormData) | 单文件直传（≤50MiB） |
| `/api/v1/uploads` | POST | 分片会话创建 |
| `/api/v1/uploads/{id}` | GET / DELETE | 查询进度（续传用）/ 取消 |
| `/api/v1/uploads/{id}/parts/{n}` | PUT | 传分片（AbortSignal） |
| `/api/v1/uploads/{id}/complete` | POST | 合并 |
| `/api/v1/files/{id}` | PATCH / DELETE | 重命名 / 移入回收站 |
| `/api/v1/files/{id}/move` | PATCH | 移动文件 |
| `/api/v1/files/{id}/content` | GET | 预览/下载共用（含流式截断读取） |
| `/api/v1/files/{id}/restore` | POST | 恢复 |
| `/api/v1/trash?page` | GET | 回收站列表 |
| `/api/v1/trash/{id}` | DELETE | 永久删除 |
| `/api/v1/storage/usage` | GET | 已用字节 |
| `/api/v1/knowledge/ask` | POST | 文件问答（AbortSignal） |

分片上传策略不变：`file.size > 阈值`（旧版 50MiB 上限走分片）→ start → 按 `part_size` 切片 → 并发上限（旧版为顺序/低并发，正式版提到 3–4 并发——我的判断）→ complete；失败任务凭 `uploaded_parts` 续传。

TanStack Query key：`['files',folderId,page]`、`['folders',parentId]`、`['trash',page]`、`['search',q,page]`、`['usage']`；所有 mutation 成功 → invalidate 相关 key + toast。

## 7. 视觉与性能策略

- **玻璃分层**：背景固定一层 → 内容滚动其上 → `backdrop-filter` 只用于工具条、卡片壳、弹层、导航；**表格行不用 backdrop-filter**，用半透明底色
- 默认**暗色**主题（旧版主体偏暗，玻璃在暗底最有质感），提供 light/dark 切换并持久化——我的判断
- 品牌：`BrandMark` 重绘为 lucide 图标 + 渐变文字（`gradient-text`）；像素土拨鼠场景图（`StorageScene`/`particle-field` 风）是否保留见 §10
- bundle 基线：spike 全量 barrel 导入 gzip 180KB；正式版先依赖 Vite tree-shaking，若单 chunk 未明显下降则降级方案：改用 `npx glinui add <组件>` 复制源码进 `src/components/ui`（同库同源，无运行时依赖变化）
- 验收测帧：1080p、150 行数据、DevTools Performance 滚动无长任务堆积

## 8. 迁移与回滚

1. 分支 `feat/react-glinui-rewrite`，按 §9 顺序实施
2. 本地 `vite build` + 静态 preview 过功能清单后，走现有 bundle→scp→nginx 流程部署；nginx root 不变（`/opt/agentcloudstorage/web/dist`），替换即上线，回滚 = 重新部署旧 dist（或 git revert）
3. 历史路由兼容：`/` → `/files`，`/trash` 不变

## 9. 实施顺序（供后续 plan 细化）

1. 骨架：Vite/React/Tailwind4/Glin UI provider + 主题 + 路由 + auth store + api 层移植（含错误映射）
2. 登录页
3. 外壳 + 文件列表（浏览/分页/搜索）
4. 上传（直传 + 分片 + 队列 + 拖拽）
5. 操作集（建/改名/移动/删除 + 右键菜单 + 选择浮条）
6. 预览 sheet + 下载
7. 回收站
8. 文件问答抽屉
9. 视觉打磨（背景/主题/空态/骨架屏）+ 性能验证 + 部署演练

## 10. 待用户确认（Open Questions）

1. **导航形态**：左侧可折叠 sidebar（本方案默认）还是底部 macOS 风 glass-dock？影响外壳布局
2. **品牌元素**：像素土拨鼠 / `StorageScene` 场景图保留吗（登录页与空态背景）？还是纯渐变极光风
3. **视觉方向最终确认**：spike 效果（毛玻璃风，非真折射）已看过且无异议——视为默认通过；若实际想要真折射效果须换回 `liquid-glass-react` 路线，整个组件体系随之重议，请在动工前提出

## 11. 留给实施者的自由度

- 组件 props 级别的样式微调（surface variant：glass/liquid/matte/outline 的搭配）
- 自建件的具体实现方式（DropOverlay、上传队列的 DOM 结构）
- 测试策略（推荐至少 vitest 覆盖 lib/ 与 api/）
- 代码分割粒度（懒加载 trash/问答即可）
