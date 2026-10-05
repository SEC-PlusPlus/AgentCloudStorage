# M1 开发文档：应用基础与账号

状态：用户已批准（2026-10-03）。
编码状态：已完成；生产构建通过。真实 API 登录/注册联调待 Go 后端运行时确认。

## 目标

搭好 Vue 前端基础，并实现登录、注册和会话管理。登录后进入网盘外壳页，为后续文件工作台提供品牌区、侧栏和内容区；M1 暂不实现文件列表或文件操作。

## 页面与交互

### 登录/注册页

- 品牌名 `AgentCloudStorage`，中文副标题“个人云仓”。
- 视觉基调采用深靛蓝、Go 蓝、青色微光；侧栏展示原创像素风 Go 风格云仓助手（透明 PNG）。
- 可切换登录与注册表单：邮箱、密码；注册另需用户名。
- 提交期间禁用重复提交；字段错误、密码错误和服务不可用有明确提示。
- 粒子/星尘只作低密度背景装饰；支持减少动态效果的系统偏好和窄屏布局。

### 登录后的应用外壳

- 品牌栏、侧边导航（“我的文件”“回收站”先作为导航壳）、用户邮箱/退出入口、主内容占位区。
- M1 暂不请求文件或回收站数据；这两项功能在 M2/M3 实现。

## API 与会话

- `POST /api/v1/auth/login` 请求 `{ "email": string, "password": string }`；成功响应含 `access_token`、`token_type`、`expires_at` 和 `user`。
- `POST /api/v1/auth/register` 请求 `{ "username": string, "email": string, "password": string }`；成功响应用户资料；随后转到登录状态，不自动假设注册成功即登录。
- JWT 放在 `sessionStorage`；路由守卫只允许有效会话访问网盘外壳。过期或 API 返回 401 时清除会话并回登录页。
- 密码只在提交时存在于表单状态，不保存到浏览器存储、不写控制台。

## 计划文件

- `web/package.json`、`web/index.html`、`web/vite.config.ts`、`web/tsconfig.json`
- `web/src/main.ts`、`web/src/App.vue`、`web/src/style.css`
- `web/src/router/index.ts`
- `web/src/api/client.ts`、`web/src/api/auth.ts`
- `web/src/stores/auth.ts` 或轻量 `web/src/composables/useAuth.ts`（以代码复杂度决定其一）
- `web/src/pages/AuthPage.vue`、`web/src/layouts/AppShell.vue`
- `web/src/components/BrandMark.vue`、`web/src/components/ParticleField.vue`

不一定要创建所有列出的组件；实现时优先保持模块边界清楚，避免为装饰过度拆文件。

## M1 验收标准

1. `npm run dev` 能启动，并经 Vite 代理访问本地 Go API。
2. 正确账号登录后进入应用外壳，刷新后同一浏览器会话仍有效。
3. 错误密码有清晰反馈；注册成功后可登录；退出后回到登录页。
4. 过期会话不进入受保护页面，401 后清除 token。
5. 移动视口下表单与外壳不溢出；启用减少动态效果时粒子动画停止。
6. `npm run build` 通过；不记录密码或 token。

## 不在 M1 范围

文件/文件夹 API、目录导航、搜索、上传下载、回收站数据、真实配额百分比、Agent UI、部署和在线预览。

## 审批点

请先确认或修改：视觉方向、登录页是否保留粒子、注册是否在第一版开放、M1 页面边界。批准后再开始 M1 编码。

## 实现记录

- 使用 Vue 3、TypeScript、Vite 与 Vue Router；不引入大型 UI 框架。
- 完成邮箱登录、用户注册、JWT 会话 `sessionStorage`、过期路由拦截、401 清理会话及退出登录。
- 完成响应式登录页与登录后应用外壳；文件/回收站导航仅作未开放状态展示。
- 使用原创透明 PNG 像素风 Go 风格云仓助手、低密度 Canvas 星尘；尊重 `prefers-reduced-motion`。
- Vite 将 `/api` 和 `/healthz` 代理至本地 Go 服务 `127.0.0.1:8080`。
- 已通过 `npm run build`；尚未在本轮完成登录 API 的真实手动联调。

### 2026-10-05 登录页视觉更新

- 吉祥物素材改为以用户提供的蓝色 Go 鼠图片为原型生成的透明底像素插画：`web/public/images/go-mouse-pixel-v2.png`。
- 登录页移除 Canvas 粒子、椭圆轨道、水晶主题和重复品牌卡片，改用纯色底、清晰表单层级和更克制的像素角色展示。
- 保留登录/注册逻辑、响应式布局、可访问文本与现有 API 行为；`npm run build` 通过。
