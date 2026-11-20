// 选中行右栏详情面板（Task 2-B / 布局密度计划 §B）：**纯呈现件**——数据/动作全由页面派生注入
// （selection subjects + actions/bulkActions 回调 props），本组件零业务、零 mutation、零请求。
// 数据源裁定 abc-3：checkbox 勾选集合是唯一事实源；单击行名仍走预览/进目录，不劫持为选择——
// 面板只消费 FilesTable onSelectionChange / TrashPage 本地勾选的既有上抛，不另开选中通道。
// 形态契约（brief §B）：无选中=返回 null（外层 grid 回单栏）；单行=大图标+名称+元数据行
// （类型/大小/修改时间|删除日期/所在目录，页面按语境给 label）+ 动作钮组；多行=「已选 N 项」
// 计数摘要 + 批量动作。关闭钮=上抛 onClose，由页侧清勾选（FilesPage 经 clearSelectionToken 缝
// 双向复位 checkbox，TrashPage 直清本地 Set）。
// 不可用动作=aria-disabled + onClick 守卫 + vendored Tooltip glass 显 reason（⑮ 模式，同
// PreviewSheet/RowToolbar 头注裁定：原生 disabled 吞 pointer 事件，reason 须 hover 可达）。
// 裁定钉：abc-2——回收站侧动作只给「恢复」，**永久删除永不进面板**（面板非确认渠道，防误触；
// 确认语义=行内按钮→AlertDialog 专用通道）。abc-4——单选时本面板是唯一动作载体（RowToolbar 隐藏），
// 多选时与浮条并存（各持批量语义）。
// 窄屏（<lg）隐藏：容器类 `hidden lg:block`——jsdom 不跑媒体查询，隐藏行为由类锚 + 浏览器矩阵
// C12.2 双钉；lg 起右栏 ~340px、sticky 顶对齐（滚动列表时元数据不溜出视口）。
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { Button } from '@/components/glinui/components/button'
import { GlassCard, GlassCardContent, GlassCardHeader } from '@/components/glinui/components/glass-card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/glinui/components/tooltip'
import { cn } from '@/components/glinui/lib/cn'

/** 元数据行（label/value 文本对；value 由页面按语境格式化，组件不做二次加工）。 */
export interface DetailPanelField {
  label: string
  value: string
}

/** 动作钮（label=可访问名；disabled+reason 走 ⑮ aria-disabled 模式；danger=红色危险语义类）。 */
export interface DetailPanelAction {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  reason?: string
  danger?: boolean
}

/** 单行呈现主体（页面自 FileRow/Trash FileItem 映射；图标+tone 与 A 的行图标同源 lib/file-icons）。 */
export interface DetailPanelSubject {
  key: string
  name: string
  icon: LucideIcon
  toneClass: string
  fields: DetailPanelField[]
}

export interface DetailPanelProps {
  /** 勾选集合（长度决定单/多形态；0=不渲染）。 */
  selection: DetailPanelSubject[]
  /** 单行动作组（仅 selection.length===1 消费）。 */
  actions: DetailPanelAction[]
  /** 多行批量动作组（仅 selection.length>1 消费）。 */
  bulkActions: DetailPanelAction[]
  onClose: () => void
}

function ActionButton({ action }: { action: DetailPanelAction }) {
  const Icon = action.icon
  const button = (
    <Button
      size="sm"
      variant="glass"
      className={cn(action.danger && 'text-red-600 dark:text-red-400')}
      // aria-disabled（非原生 disabled）：吞事件会让 tooltip reason 不可达（⑮ 裁定）
      aria-disabled={action.disabled ? 'true' : undefined}
      onClick={() => {
        if (!action.disabled) action.onClick()
      }}
    >
      <Icon size={14} />
      {action.label}
    </Button>
  )
  if (!action.disabled || !action.reason) return button
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent variant="glass" side="top">
          {action.reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function DetailPanel({ selection, actions, bulkActions, onClose }: DetailPanelProps) {
  if (selection.length === 0) return null
  const single = selection.length === 1 ? (selection[0] ?? null) : null

  return (
    <aside
      role="complementary"
      aria-label="选中详情"
      data-testid="detail-panel"
      // 窄屏隐藏 + lg 右栏 ~340px + sticky 顶对齐（brief §B；类锚测试钉 hidden/lg:block）。
      // sticky 顶=72px（终评修波 #3：TopBar min-h-14=56px + 16px 呼吸位；旧 lg:top-4=16px 会顶进
      // 固定 TopBar 身后）；<lg 单选的动作面兜底在 RowToolbar（abc-6），本面板维持 hidden 语义。
      className="hidden w-[340px] shrink-0 lg:sticky lg:top-[72px] lg:block"
    >
      <GlassCard size="sm">
        <GlassCardHeader className="flex flex-row items-start gap-2">
          {single ? (
            <>
              {/* 大图标托底：与行图标同 tone 表（A Established interface 消费，尺寸在调用侧） */}
              <span
                aria-hidden="true"
                data-testid="panel-icon"
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface)]/60',
                  single.toneClass,
                )}
              >
                <single.icon size={24} className="shrink-0" />
              </span>
              <span data-testid="panel-name" className="min-w-0 flex-1 break-all text-sm font-medium text-[var(--color-foreground)]">
                {single.name}
              </span>
            </>
          ) : (
            <span data-testid="panel-count" className="min-w-0 flex-1 text-sm font-medium tabular-nums text-[var(--color-foreground)]">
              已选 {selection.length} 项
            </span>
          )}
          <Button size="sm" variant="ghost" aria-label="关闭详情" onClick={onClose}>
            <X size={14} />
          </Button>
        </GlassCardHeader>

        <GlassCardContent className="flex flex-col gap-3">
          {single ? (
            <>
              <dl className="flex flex-col gap-1.5">
                {single.fields.map((field) => (
                  <div key={field.label} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-xs opacity-60 text-[var(--color-foreground)]">{field.label}</dt>
                    <dd
                      data-testid={`panel-field-${field.label}`}
                      className="min-w-0 truncate text-right text-sm tabular-nums text-[var(--color-foreground)]"
                    >
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div role="toolbar" aria-label="选中项操作" className="flex flex-wrap items-center gap-1.5">
                {actions.map((action) => (
                  <ActionButton key={action.label} action={action} />
                ))}
              </div>
            </>
          ) : (
            <div role="toolbar" aria-label="批量操作" className="flex flex-wrap items-center gap-1.5">
              {bulkActions.map((action) => (
                <ActionButton key={action.label} action={action} />
              ))}
            </div>
          )}
        </GlassCardContent>
      </GlassCard>
    </aside>
  )
}
