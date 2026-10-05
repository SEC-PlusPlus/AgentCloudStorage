# M6 文件在线预览开发文档

状态：前端实现完成（2026-10-05）；真实 API/MinIO 文件预览待手动联调。

## 目标

在文件工作台中预览常见图片、PDF 和纯文本文件。此模块只修改 `web/` 下的前端代码，复用现有已鉴权的 `GET /api/v1/files/:id/content` 下载接口，不变更任何 Go 后端文件。

## 支持范围

- 图片：PNG、JPEG、GIF、WebP、AVIF。
- 文档：PDF。
- 文本：TXT、Markdown、LOG、CSV。Markdown 按原文显示，不解析为 HTML。
- SVG、HTML、Office 文件、音视频暂不提供预览。
- 大于 100 MiB 的图片/PDF不在浏览器中预览，提示下载查看；文本最多读取前 2 MiB，并明确提示内容被截断。

## 实现流程

1. 文件列表只对支持的扩展名显示“预览”操作。
2. 前端使用现有 JWT Bearer 请求下载接口，避免把未携带 Authorization 头的 URL 直接交给 `iframe` 或 `img`。
3. 图片与 PDF 根据扩展名映射到固定 MIME 类型后生成 Blob URL；文本作为字符串读取并由 Vue 文本插值显示。
4. 关闭预览、切换文件或卸载页面时释放 Blob URL。
5. 预览读取失败时复用现有 API 错误提示，用户可关闭窗口并继续下载。

## 安全与边界

- 不信任服务端返回的 Content-Type 来决定可执行内容；只按前端固定白名单展示。
- 不预览 SVG、HTML，不使用 `v-html`。
- 内容仍由已有后端鉴权和文件归属校验保护。
- 现有后端将内容作为附件及 `application/octet-stream` 返回，所以浏览器需要先用带令牌的 fetch 获取内容，再创建带白名单 MIME 的 Blob URL。
- 当前没有 HTTP Range 支持；PDF/图片预览会先把文件完整读入浏览器，故设置 100 MiB 上限。

## 验收项

- 图片、PDF、TXT/Markdown/LOG/CSV 可以打开预览并正确关闭。
- 不支持格式无预览入口；SVG/HTML 不被当作网页执行。
- 文本超过 2 MiB 时截断并显示提示；图片/PDF 超过 100 MiB 时提示下载查看。
- 未登录、文件不存在、服务不可用时显示可理解的错误。
- 关闭/切换预览时释放 Blob URL。
- `npm run build` 通过；真实 MinIO/API 内容预览待依赖服务可用后手动联调。

## 实现记录

- `web/src/api/storage.ts` 抽出带 Bearer 令牌的文件内容读取；文本预览按字节流最多读取 2 MiB。
- `web/src/pages/FileWorkbench.vue` 为允许的格式增加预览入口和弹窗；图片/PDF使用白名单 MIME Blob URL，文本通过纯文本节点展示。
- `web/src/workbench.css` 增加桌面和移动预览样式。
- 后端代码未修改。
