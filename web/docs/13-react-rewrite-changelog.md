# 13 · React 重写改动追踪（每任务提交必更新，与代码同 commit）

规范见 `12-react-rewrite-development-standards.md`；spec 节引用 `docs/superpowers/specs/2026-11-18-react-glinui-frontend-rewrite-design.md`。

| 日期 | commit | 任务 | 摘要 | spec 节 | 测试证据 |
|---|---|---|---|---|---|
| 2026-11-18 | Task 1 (58dbca0..HEAD) | Task 1 分支/骨架/治理文档/素材候选 | 建 `feat/react-glinui-rewrite` 分支；删除 Vue 前端源码（`git rm`，历史保留于 adbcfba）；Vite react-ts 骨架 + Tailwind v4 + `@glinui/tokens`；tsconfig `paths @/*` + vite alias；vitest(jsdom)+test-setup+smoke 测试；新增开发规范、本追踪表、asset-credits（3 个 logo 候选待用户确认） | §3、§4、§7.1 | `npm run build` 零错误；`npm test -- --run` 3 passed（smoke：表达式 + jsdom 环境 + @/App 别名解析） |
| 2026-11-19 | Task 3 (19e348e..) | Task 3 API 层/auth store/lib 工具 | 自 adbcfba 移植 `api/client.ts`（`request`/`ApiError`/`translateError` 约 30 条映射原样 + FileWorkbench 413/507 两条文案并入；401 解耦为 `setUnauthorizedHandler`，client 不再 import store）、`api/auth.ts`、`api/storage.ts`（23 个导出函数，`token()` 改读 zustand；`fetchTextPreview` 流式截断与 `downloadFile` 锚点法原样）、`api/knowledge.ts`；`stores/auth.ts`（zustand，sessionStorage 三键名逐字节同旧版，过期 restore 自动清除，`isAuthenticated`/`getToken`）；`lib/format.ts`（`formatBytes` 同旧 `formatSize`；`formatDate` 按 brief 改本地 YYYY-MM-DD，替代旧 zh-CN 斜杠格式）；纯 TS 零 UI 依赖 | §6 | `npm test -- --run` 53 passed（client 36：30 条映射表驱动 + request 6；auth 6；format 8；smoke 3；RED 先行：3 测试文件 import 失败→实现后全绿）；`npm run build` 零错误，JS gzip 68.59 KB < 250 KB |
