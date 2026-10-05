# AgentCloudStorage 前端总体方案

更新时间：2026-10-03
状态：总体方案已确认；M1 正在实现。

## 目标

为现有 Go 网盘 API 提供可日常使用的桌面和移动端网页。前端只实现后端已经支持的功能，不把计划中的 Agent 能力伪装成可用功能。

## 技术方案

- Vue 3 Composition API + TypeScript + Vite。
- Vue Router 负责登录页、网盘页和路由守卫。
- 使用原生 CSS 和少量可复用 Vue 组件构建界面，不使用默认后台模板；首版不引入大型 UI 框架或全局状态库。
- 用 Vite 开发代理把 `/api` 转发到 Go 服务 `http://127.0.0.1:8080`。生产环境由同域反向代理转发 `/api`，首版不要求修改后端 CORS。
- JWT 暂存在 `sessionStorage`，在当前浏览器会话中使用；退出、401 或过期时清除。后端目前没有 Refresh Token 或 HttpOnly Cookie 能力。

## 视觉方向

主题暂定为“轨道云仓”：深靛蓝与 Go 蓝为主色，辅以青色和少量荧光绿；文件区保持高对比度与清晰层级。背景使用稀疏星尘、轨道线与柔和光晕；登录页加入原创像素风 Go 风格云仓助手，像素元素作为品牌点缀，不让整体变成复古游戏界面。该形象不直接冒用 Go 官方 Gopher 图稿。

动效集中在页面切换、拖放上传、进度反馈、对话框和装饰性粒子。粒子只做背景装饰，避免遮挡文字和操作；遵守 `prefers-reduced-motion`，低功耗设备上减少或关闭粒子。

## 模块与审批顺序

每个模块开始编码前先更新对应模块开发文档和 `feature-progress.md`，提交给用户审批。得到该模块认可后再实现；模块验收后更新进度文档，再编写下一个模块文档。

1. **M1 应用基础与账号**：项目脚手架、全局视觉基础、登录/注册、会话状态、路由守卫、退出登录。
2. **M2 文件工作台**：文件与文件夹列表、目录导航、面包屑、创建文件夹、上传与进度、下载、重命名、移动、软删除。
3. **M3 搜索与回收站**：文件名搜索、分页、回收站列表、恢复、永久删除、用量展示。
4. **M4 体验收尾**：响应式布局、空状态与错误提示、键盘操作、动效性能和端到端手动验收。

模块范围可以在审批时调整；未批准的模块不提前写代码。

## API 映射与已知边界

| 页面能力 | 后端 API | 约束 |
|---|---|---|
| 登录 | `POST /api/v1/auth/login` | 返回 JWT、过期时间和用户资料 |
| 注册 | `POST /api/v1/auth/register` | 注册后需再登录 |
| 当前目录文件 | `GET /api/v1/files?folder_id=&page=&page_size=` | 只列当前目录文件，按服务端分页 |
| 当前目录文件夹 | `GET /api/v1/folders?parent_id=` | 只列直接子文件夹；无获取任意目录祖先链 API |
| 新建文件夹 | `POST /api/v1/folders` | JSON：`name`、`parent_id` |
| 重命名/移动/删除文件夹 | `PATCH /api/v1/folders/:id`、`PATCH /api/v1/folders/:id/move`、`DELETE /api/v1/folders/:id` | 只能删除空文件夹 |
| 上传/下载文件 | `POST /api/v1/files`、`GET /api/v1/files/:id/content` | 单文件上限约 50 MiB；下载是附件，不提供在线预览 |
| 重命名/移动/回收文件 | `PATCH /api/v1/files/:id`、`PATCH /api/v1/files/:id/move`、`DELETE /api/v1/files/:id` | 删除进入回收站 |
| 搜索 | `GET /api/v1/files/search?q=&page=&page_size=` | 搜索文件名，不搜索文件夹 |
| 回收站 | `GET /api/v1/trash?page=&page_size=`、`POST /api/v1/files/:id/restore`、`DELETE /api/v1/trash/:id` | 永久删除不可恢复 |
| 用量 | `GET /api/v1/storage/usage` | 当前只返回 `used_bytes`，不返回总配额，界面不显示虚构的容量百分比 |

其他已知边界：MVP 不做在线预览、分享链接、批量操作、分片上传、秒传或 Agent 知识库。搜索结果只给出 `folder_id`，目前无法由 API 还原完整目录路径。

## 验收原则

- 每个 UI 动作只调用现有 API，严格按实际请求/响应字段实现。
- 401 清理会话并引导重新登录；413、507、404、409 展示可理解的中文反馈。
- 上传、移动和删除成功后刷新受影响列表与用量。
- 不把 JWT、密码、MinIO 凭据写入代码、构建产物配置或 Git。
- M4 完成后再报告整个前端 MVP 验收状态；构建通过不等同于真实 API 联调通过。

## 官方技术参考

- Vue 快速开始与脚手架：<https://vuejs.org/guide/quick-start.html>
- Vue + TypeScript：<https://vuejs.org/guide/typescript/overview.html>
- Vite 开发代理：<https://vite.dev/config/server-options.html#server-proxy>
