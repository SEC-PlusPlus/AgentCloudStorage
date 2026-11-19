# 12 · React 重写开发规范（治理文档 · 每个任务开工前必读）

适用范围：`web/` 全部 React 代码。配套追踪文档：`13-react-rewrite-changelog.md`。
上位依据：`docs/superpowers/specs/2026-11-18-react-glinui-frontend-rewrite-design.md`（spec v2.1）与实施计划 Global Constraints。冲突时以 spec 为准，并在 changelog 记录偏离。

## 1. 目录职责

| 目录 | 放什么 | 不放什么 |
|---|---|---|
| `src/api/` | `client.ts`（request/ApiError/translateError）、`auth.ts`、`storage.ts`、`knowledge.ts`，纯 TS 无 React 依赖 | 组件、hook |
| `src/stores/` | zustand：仅 auth 会话与跨组件 UI 状态 | 服务端数据 |
| `src/lib/` | `cn.ts`、bytes/date 格式化、纯函数（如 `computeInvalidations`） | 任何 JSX |
| `src/components/glinui/` | vendor 的 Glin UI 源码（含其 `lib/`），带来源头注释 | 手改的 vendor 件、业务件 |
| `src/components/app/` | 自建件（DropOverlay、UploadQueuePanel、StorageMeter、GopherScene…）及 vendor 缺陷覆写件 | 第二套组件体系 |
| `src/features/` | `files/`、`trash/`、`auth/` 按业务聚合的片段组件与局部 hook | 全局基础设施 |
| `src/routes/` | 路由组件：`login`、`(app)` 布局、`files`、`trash` | 业务逻辑（下沉 features） |
| `src/providers/` | QueryClientProvider、AuthProvider、Theme（`.dark` 持久化） | 页面内容 |

依赖方向只允许：routes → features → components/app → components/glinui；api/stores/lib 可被任意层引用，但 api 不得 import React。

## 2. 命名

- 组件 PascalCase（`UploadQueuePanel`）；文件一律 kebab-case（`upload-queue-panel.tsx`）。
- 自定义 hook `use` 前缀（`useFileList`），文件名同 hook 名。
- 事件处理 props 用 `onX` / `handleX` 对；布尔 props 肯定式（`disabled` 而非 `notEnabled`）。

## 3. TypeScript

- `strict` + `noUncheckedIndexedAccess` 全开（已在 tsconfig 固化），禁降级。
- 禁 `any`；确需类型断言 `as`，行尾注释理由（`// 理由：接口返回 union 未收窄`），无注释的 `as`/`any` 评审直接打回。
- API 响应一律定义 interface（放 `src/api/` 对应文件并 export）。

## 4. 样式

- 配色唯一来源：Tailwind 工具类 + `@glinui/tokens` CSS 变量。禁 hex/rgb 字面量（asset-credits 与 vendor 源码内部除外）。
- 主题切换用 `<html class="dark">`（tokens 已支持），默认暗色，选择持久化 localStorage。
- 禁内联 `style`，动效运行时计算值（transform 进度等）除外。
- 玻璃分层：`backdrop-filter` 只用于 navbar/dock/卡片壳/浮层；表格行用半透明底色，禁逐行糊玻璃。

## 5. 状态

- 服务端数据只走 TanStack Query。key 规范（spec §6）：`['files',folderId,page]`、`['folders',parentId]`、`['trash',page]`、`['search',q,page]`、`['usage']`、`['crumbs',folderId]`。
- mutation 成功 → invalidate 相关 key（源目录、目标目录、面包屑、用量四者，见 spec §6 末「TanStack Query key」段；T13 carry #1：原引「Review Focus 4」为计划侧文档，规范正文改指 spec 锚点）+ sonner toast。
- 只有跨组件 UI 状态与服务端不承载的会话才进 zustand。
- 会话兼容旧版：sessionStorage `acs.access-token` / `acs.expires-at` / `acs.user`；localStorage `acs.multipart.<uid>`。
- 上传阈值：`file.size >= 49 * 1024 * 1024` 走分片，否则直传；问答限制 `file.size > 1 << 20` 禁用、问题 maxLength 500。

## 6. 错误

- UI 一律显示 `ApiError.message`（translateError 已中文化，约 30 条映射原样移植），经 sonner toast；禁裸 `error.message`、禁 alert。
- 401：清会话 → 跳 `/login` → toast「登录已过期」。
- 禁 `console.log` 进生产构建（调试残留提交前删除）。

## 7. 异步透传

- 上传分片、文件问答等可取消异步，函数签名必须接受 `AbortSignal` 参数并透传到 fetch（配合 TanStack Query `signal` / 手写 controller）。

## 8. 测试

- 纯逻辑必测（vitest，放被测文件旁 `*.test.ts`）：`lib/`、`api/`（错误映射、translateError）、上传切片、`computeInvalidations` 等。
- UI 关键流程不写自动化（不建 E2E），改以手测清单逐条记入 changelog「测试证据」列。

## 9. 提交

- Conventional Commits（feat/fix/test/docs/refactor/chore 前缀）。
- 每任务至少一个 commit，且同 commit 追加 changelog 一行（日期/commit/任务/摘要/spec 节/测试证据）。
- 构建门槛：`npm run build`（`tsc -b && vite build`）零错误；最终 JS gzip < 250KB。

## 10. Vendor 规则

- `src/components/glinui/` 每文件头注释：`// vendored from glinui.com/r/<name>.json @<YYYY-MM-DD>`。
- 禁止手改 vendor 源码；发现缺陷 → 在 `src/components/app/` 建覆写件，并在 changelog 与 asset-credits 同级 README 记录偏离。
- vendor 件引入的 npm 依赖（Radix 子包、cva、sonner、cmdk 等）按其 `dependencies` 字段补装。
- 永禁安装 `@glinui/ui` 运行时包；vendor 获取走 `https://glinui.com/r/items/<name>.json` 手工抓取，不用 `npx glinui` CLI。

## 11. 素材

- 禁 AI 生成；只用网络现存设计，许可证限 MIT/ISC/CC0/CC-BY（CC-BY 须署名）；每个素材登记 `asset-credits.md`。
