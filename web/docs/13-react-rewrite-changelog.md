# 13 · React 重写改动追踪（每任务提交必更新，与代码同 commit）

规范见 `12-react-rewrite-development-standards.md`；spec 节引用 `docs/superpowers/specs/2026-11-18-react-glinui-frontend-rewrite-design.md`。

| 日期 | commit | 任务 | 摘要 | spec 节 | 测试证据 |
|---|---|---|---|---|---|
| 2026-11-18 | 58dbca0 + 本 feat/docs 两 commit | Task 1 分支/骨架/治理文档/素材候选 | 建 `feat/react-glinui-rewrite` 分支；删除 Vue 前端源码（`git rm`，历史保留于 adbcfba）；Vite react-ts 骨架 + Tailwind v4 + `@glinui/tokens`；tsconfig `paths @/*` + vite alias；vitest(jsdom)+test-setup+smoke 测试；新增开发规范、本追踪表、asset-credits（3 个 logo 候选待用户确认） | §3、§4、§7.1 | `npm run build` 零错误；`npm test -- --run` 2 passed（smoke：表达式 + jsdom 环境断言） |
