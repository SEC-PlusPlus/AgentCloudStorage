# 素材来源与许可证登记（asset-credits）

规则（spec §7.1）：禁止 AI 生成；只用网络现存设计；许可证限 MIT/CC0/CC-BY（CC-BY 须署名）。
状态标记：「候选·待用户确认」/「采用」/「仓库既有保留素材」。

## 采用（现有素材与主图标源）

| 名称 | 用途 | 来源 | 作者 | 许可证 | 备注 |
|---|---|---|---|---|---|
| `cloud-gopher-pixel.png` | 登录 hero、空态、拖放遮罩（土拨鼠主视觉，按 2026-11-18 裁决直接采用） | 仓库既有保留素材（`web/public/images/`，git 历史自 08/09 文档期） | 来源待用户补充 | 待用户补充 | spec §1 决定保留；上线前须补来源确认 |
| `go-mouse-pixel-v2.png` | 备用土拨鼠图（同上场景候选） | 仓库既有保留素材（`web/public/images/`） | 来源待用户补充 | 待用户补充 | 同上 |
| lucide 图标集（含 `Cloud`，本机已验证导出可用） | 全局主图标源（dock/按钮/菜单） | https://lucide.dev （npm `lucide-react@^1.74.0`，已装） | Lucide Contributors | ISC（spec §3 写作 MIT；实际包 license 为 ISC，宽松度等同，此处按实登记） | 按需 import，符合性能约束 |

## 候选·待用户确认（主 logo / favicon，3 项）

| # | 名称 | 候选用途 | 来源 URL | 作者 | 许可证 | 核实状态 |
|---|---|---|---|---|---|---|
| 1 | Pixel Art Clouds（24x24 像素云朵组） | favicon / 品牌角标（像素风，与土拨鼠 mascot 最贴） | https://opengameart.org/content/pixel-art-clouds | dustdfg | CC0 | 已核实（2026-11-18 抓取页面，标题+CC0 标记确认） |
| 2 | 2D Pixel Clouds（云朵素材集） | favicon / 登录页装饰云 | https://opengameart.org/content/2d-pixel-clouds | dan-ryder | CC0 | 已核实（2026-11-18 抓取页面，CC0 标记确认） |
| 3 | Nikoichu Pixel Icons（1300+ CC0 像素图标，含云/天气类） | logo 备选（如需更多形状） | https://nikoichu.itch.io/pixel-icons | Nikoichu | CC0（据检索结果自述） | 来源核实待网络恢复（2026-11-18 本机直连 itch.io 失败，仅经搜索引擎确认存在） |

选定前不动用以上三项于任何界面；确认后把选定项移入「采用」区并在 13 号追踪表记一行。

## 历史与例外

- 旧版 `BrandMark.vue` 手绘 SVG：随 `web/src/` 删除（git 历史保留于 `adbcfba`）；按 spec §7.1 不作废，如需复刻从历史提取。
- vendor 的 Glin UI 组件源码内部颜色字面量不计违规（规范 §4/§10 豁免）。
- 旧版素材登记（`web/docs/09-auth-motion-brand-development.md` 等）仍有效，作为历史文档保留。
