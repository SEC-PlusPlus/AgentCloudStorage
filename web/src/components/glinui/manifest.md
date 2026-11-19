# glinui vendor manifest

- **取回日期：** 2026-11-19
- **模式：** PATH B —— npm 包 `@glinui/ui@0.1.1` 的 `dist/`（编译产物 `.js` + 邻接 `.d.ts`），非 registry `.tsx` 源码
- **原因：** `https://glinui.com/r/index.json` 连通性探测 3 次 × 20s 超时全部失败（2026-11-18 尖峰期可用，已中断 24h+）
- **头注释格式：** `// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19`
- **swap 计划：** **Task 13** 在 registry 恢复可达后用 `web/scripts/vendor-glinui.mjs`（本任务已写好，PATH A 机制）把编译产物整体替换为 registry `.tsx` 源码；替换前禁止对 `components/*.js|d.ts` 做本地魔改，只允许新增薄 wrapper
- **app 代码禁止 import `@glinui/ui`**；该包曾以 devDependency 短暂装入用于复制，最终提交前已从 package.json + lockfile 移除（全局约束）

## 已 vendor 组件（31 个，`components/`，import 路径 `@/components/glinui/components/<name>`）

glass-dock, glass-navbar, glass-breadcrumb, table, command, modal, sheet, dropdown-menu, tooltip, toast, input, label, button, checkbox, progress, tree, floating-panel, aurora-background, dot-pattern, blur-fade, separator, kbd, heading, text, glass-card, textarea, skeleton, alert, alert-dialog, avatar, badge

导出符号与 brief Interfaces 清单核对：`GlassCardHeader/GlassCardContent/GlassCardFooter`（无 GlassCardTitle/GlassCardBody —— 以 dist 为准）；Button variant 键为 `default|glass|frosted|liquid|matte|glow|outline|ghost`，size `sm|md|lg`。

## lib（`lib/`）

- `cn.ts` —— **手写**（brief Step 3；dist 的 `cn.js/cn.d.ts` 未复制，避免同名模块二义），实现与 dist 一致：`clsx` + `tailwind-merge`
- `use-prefers-reduced-motion.js/.d.ts` —— vendored（glass-dock/glass-navbar 依赖）
- `use-liquid-glass` —— 未复制：vendored 组件集无任何文件 import 它

## 运行时 npm 依赖（已装入 package.json dependencies）

| 包 | 版本范围 | 使用方 |
|---|---|---|
| class-variance-authority | ^0.7.1（已有） | 多数组件 |
| clsx / tailwind-merge | 已有 | lib/cn.ts |
| lucide-react | ^1.74.0（已有） | checkbox/command/dropdown-menu/modal/sheet/toast/tree |
| cmdk | 新装 | command |
| @radix-ui/react-alert-dialog | 新装 | alert-dialog |
| @radix-ui/react-checkbox | 新装 | checkbox |
| @radix-ui/react-dialog | 新装 | modal, sheet |
| @radix-ui/react-dropdown-menu | 新装 | dropdown-menu |
| @radix-ui/react-progress | 新装 | progress |
| @radix-ui/react-slot | 新装 | button |
| @radix-ui/react-toast | 新装 | toast |
| @radix-ui/react-tooltip | 新装 | tooltip |

sonner（已有）继续由 Task 4 的 Toaster 直挂；`toast` 为 Radix 版组件并存。
版本注记：@glinui/ui@0.1.1 自身 pin `lucide-react ^0.563.0`，app 用 ^1.74.0——vendored 集用到的图标均存在（build + jsdom 渲染冒烟通过）。

## registry-only / dist 无 → 由消费任务 SELF-BUILT（spec §11 兜底，本次不建）

`field` `empty` `pagination` `context-menu` `attachment` `code-panel` `prompt-input` `message` `message-scroller` `bubble` `thinking` `scroll-area` `spinner`

（后两项 `scroll-area`/`spinner` 为复制时实测 dist 亦无，补充记录；其余为控制端已知候选。）

## 偏差与配对注记

- `.d.ts` 尾部 `//# sourceMappingURL=` 悬空行已剥离（不复制 `.map`；`.js` 本无该注释）
- 复制零 import 改写：dist 相对路径 `../lib/cn`、`../lib/use-prefers-reduced-motion` 与 vendored 树布局天然一致
- `textarea` brief 要求单独抓取——dist 直接存在（`textarea.js/.d.ts`），已 vendored，Task 12 可任选 Textarea 或自建 PromptInput
- 类型冒烟：临时 tsx import Button/GlassCard/GlassDock/Table，`tsc -b` 于 `moduleResolution: bundler`、无 `allowJs` 下通过（`.d.ts`+邻接`.js` 配对可解析）；另经 jsdom 渲染冒烟（65 passed 临时基线）后已删除 scratch 文件

## 验证快照（最终提交态，无 @glinui/ui）

- `npm run build` 零错误；`npm test -- --run` **64 passed**（基线不劣化）

## Task 9 追加段（控制端批准的 spec §11 偏差路线）

- **新装 runtime 依赖**：`@radix-ui/react-context-menu ^2.4.1`（package.json dependencies + lockfile 实装）——
  context-menu 属下方「registry-only SELF-BUILT」名单（glinui dist 无件）。自建件
  `web/src/features/files/RowContextMenu.tsx` 基于该 Radix **无样式行为原语**（glinui 本体即 Radix 封装，
  不构成引入第三方 UI 库），外观类名逐字对齐 vendored dropdown-menu 的 glass content/item variants
  （PATH B 禁改 vendor 件，类串内联复制并注明来源）；头注释
  `// self-build on @radix-ui/react-context-menu — TODO(Task 13 swap to glinui registry context-menu)`。
- **vendored tree 消费偏离**：MoveDialog 目标选择器未直接渲染 vendored `Tree`——PATH B 编译版 TreeNode
  仅 label/children/href，无 onSelect/展开回调（选中目标目录与按 `['folders',parentId]` 惰性取子级两项
  需求均无处接线，且禁止魔改 vendor 件）；改同数据契约薄 wrapper 自建（视觉沿 tree 的玻璃边框/行距/16px
  缩进语言，键与 useFileRows/crumbs BFS 天然共享热缓存）。见 changelog Task 9 行。
- SELF-BUILT 名单进度：`context-menu` 已建（Task 9）；`field/empty/pagination` 已建（Task 5/7）；
  `attachment` 已建（Task 8）；其余不变。
