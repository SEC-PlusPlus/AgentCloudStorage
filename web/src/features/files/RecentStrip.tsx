// 根目录仪表盘带（Task 3-C / 布局密度计划 §C）：**纯呈现件**（同 DetailPanel 纪律）——
// 数据（页 1 缓存文件行 + ['usage'] 缓存）由 FilesPage 经 queryClient.getQueryData 读好后注入 props，
// 本组件零业务、零 mutation、**零请求**（abc-1 裁定：布局层，只消费既有缓存查询）。
// 渲染域（FilesPage 侧闸）：folderId===0 且非搜索态的浏览列表上方；「最近添加」直接取缓存前 N
// ——服务端 created_at DESC（本仓早前核验），recentCards 不重排；页 1 数据形态（PageResult<FileItem>）
// 按 API 天然 files-only，文件夹行结构上不可能进带（行为级钉在接线集成测试）。
// 卡片=icon（A 的 file-icons 同表 tone）+ 名称 + 大小 + 相对时间（lib/format formatRelative）；
// 点击=openPreview 同缝——mergeRows([], [item], 0) 造行（行契约唯一铸造方复用，不手抄字段防漂移）。
// 存储环=vendored ProgressCircle（.d.ts 与 progress.js 双核实在册，size sm=48px、glass variant、
// 中心百分比文本自 showValue）；usage 缓存缺位=只出卡片不出环，双缺位=返回 null。
// STRIP_HEIGHT_PX：带在 main 列纵向占位（带体 + 其下 gap-3）的单源常量——FilesPage 组
// listScrollOffsetPx=LIST_SCROLL_OFFSET_PX+本值 喂内滚 max-h（brief Step 2「避免两套魔法数」）；
// 环独降级（?page=2 深链无页 1 缓存）同带高（单行布局），不产生二次跳动。浏览器校准=C13.1。
import type { LucideIcon } from 'lucide-react'
import { GlassCard, GlassCardContent } from '@/components/glinui/components/glass-card'
import { ProgressCircle } from '@/components/glinui/components/progress'
import type { FileItem } from '@/api/storage'
import { FILE_ICON_TONE_CLASS, classifyFileIcon, fileIcon } from '@/lib/file-icons'
import { formatBytes, formatRelative } from '@/lib/format'
import { mergeRows, type FileRow } from './useFileRows'

/** ['usage'] 缓存形态（api/storage.ts getStorageUsage 返回型镜像，只读不请求）。 */
export interface UsageCache {
  used_bytes: number
  quota_bytes: number
}

/**
 * 带高单源常量（内滚扣减消费，见头注）——构成：
 *   GlassCard sm 上下壳（p-3 × 2）                        ≈ 24
 *   带内容行高 = max(环 sm 48, 双行卡 py-1.5+20+14 ≈ 48)   = 48
 *   卡片区与容器间的换行安全余量                            ≈ 0（卡片行 overflow-x-auto 恒单行）
 *   带 ↔ 列表 gap（主列 flex-col gap-3）                    = 12
 *   合计                                                    84
 * 「≈」为 vendored 组件确定档位近似；偏差由矩阵 C13.1 浏览器校准（只改本常量一处）。
 */
export const STRIP_HEIGHT_PX = 84

/** 缺省卡片上限（brief：limit 6）。 */
export const RECENT_CARD_LIMIT = 6

/**
 * 最近添加取数（纯函数）：页 1 服务端序（created_at DESC）直取前 limit，**不重排**；
 * 夹序输入的测试钉即「输出=输入前 N、逐 id 等序」。limit≤0 → 空。
 * 文件夹不混入由输入形态保证（['files',0,1] 只含文件条目，见头注）——本函数不接受行型输入。
 */
export function recentCards(files: readonly FileItem[], limit = RECENT_CARD_LIMIT): FileItem[] {
  return files.slice(0, Math.max(0, limit))
}

/**
 * 存储百分比（纯函数）：clamp 0..100 取整；quota≤0（旧数据/缺字段防御，TopBar 同口径）恒 0，绝不除零。
 */
export function usagePercent(used: number, quota: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(quota) || quota <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((used / quota) * 100)))
}

export interface RecentStripProps {
  /** recentCards 产物（页 1 缓存前 N 文件条目）。 */
  cards: readonly FileItem[]
  /** ['usage'] 缓存快照；缺位=null（只出卡片不出环）。 */
  usage: UsageCache | null
  /** 卡片点击汇入（FilesPage 传 openPreview——与行同一预览缝；入参经 mergeRows 铸造的行契约）。 */
  onOpen: (row: FileRow) => void
}

function RecentCard({ item, onOpen }: { item: FileItem; onOpen: (row: FileRow) => void }) {
  const Icon: LucideIcon = fileIcon(item.original_name, item.content_type)
  const tone = FILE_ICON_TONE_CLASS[classifyFileIcon(item.original_name, item.content_type)]
  const open = () => {
    // 行契约铸造权在 mergeRows（唯一真源）：卡片行与表格行字段口径零漂移，openPreview 直接消费。
    const [row] = mergeRows([], [item], 0)
    if (row) onOpen(row)
  }
  return (
    <button
      type="button"
      data-testid={`recent-card-${item.id}`}
      onClick={open}
      className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--color-surface)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
    >
      {/* 图标托底帧与 A 行图标/B 面板同式（span 自绘裁定沿 FILE_ICON_TONE_CLASS 头注） */}
      <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)]/60 ${tone}`}>
        <Icon size={16} className="shrink-0" />
      </span>
      <span className="flex w-36 flex-col leading-tight">
        <span className="truncate text-sm text-[var(--color-foreground)]">{item.original_name}</span>
        <span className="truncate text-[11px] tabular-nums opacity-60 text-[var(--color-foreground)]">
          {formatBytes(item.size)} · {formatRelative(item.created_at)}
        </span>
      </span>
    </button>
  )
}

export function RecentStrip({ cards, usage, onOpen }: RecentStripProps) {
  if (cards.length === 0 && !usage) return null
  const percent = usage ? usagePercent(usage.used_bytes, usage.quota_bytes) : 0
  return (
    <section aria-label="根目录概览" data-testid="recent-strip" className="min-w-0">
      <GlassCard size="sm">
        <GlassCardContent className="flex items-center gap-4 p-3">
          {usage ? (
            <div className="flex shrink-0 items-center gap-2.5">
              <ProgressCircle
                size="sm"
                variant="glass"
                value={percent}
                aria-label="存储用量"
                data-testid="usage-ring"
              />
              <div className="flex flex-col leading-tight">
                <span className="text-xs opacity-60 text-[var(--color-foreground)]">存储</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-[var(--color-foreground)]">
                  {formatBytes(usage.used_bytes)} / {formatBytes(usage.quota_bytes)}
                </span>
              </div>
            </div>
          ) : null}
          {cards.length > 0 ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-xs opacity-60 text-[var(--color-foreground)]">最近添加</span>
              {/* 横向滚动保单行：带高恒定于 STRIP_HEIGHT_PX，宽屏不足时右滑而非换行撑高 */}
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {cards.map((item) => (
                  <RecentCard key={item.id} item={item} onOpen={onOpen} />
                ))}
              </div>
            </div>
          ) : null}
        </GlassCardContent>
      </GlassCard>
    </section>
  )
}
