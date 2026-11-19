// 选择浮动操作条（Task 9）：selection 非空时出现，悬浮玻璃卡片，位置在 Dock 之上
// （Dock 固定 bottom-4 z-40，本条 bottom-24 同层级居中，pointer-events 分内外层=Dock 同款技术）。
// 语义约束（控制端裁定）：旧版无多选操作 → 移动/重命名仅单选（多选时禁用并显计数）；
// 下载仅作用于所选中的文件行（混选中只下载文件部分）；移入回收站可多选
// （文件夹=删除空目录语义，非空报错文案由服务端 translateError 呈现）。
// 「问 AI」按钮=brief 钉死项：仅单选文件行出现；Task 12 接线——canAsk 门控，不合格时
// aria-disabled+onClick 守卫（同 PreviewSheet 头部裁定：原生 disabled 吞事件，tooltip reason
// 须可达）+ vendored tooltip 呈现中文拒绝文案。
import { Download, FolderInput, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/glinui/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/glinui/components/tooltip'
import { canAsk } from '@/features/qa/qa-state'
import type { FileRow } from './useFileRows'

export interface RowToolbarProps {
  selection: FileRow[]
  onDownload(): void
  onMove(): void
  onRename(): void
  onTrash(): void
  onAsk(): void
}

export function RowToolbar({ selection, onDownload, onMove, onRename, onTrash, onAsk }: RowToolbarProps) {
  if (selection.length === 0) return null
  const single = selection.length === 1 ? (selection[0] ?? null) : null
  const hasFile = selection.some((row) => row.kind === 'file')
  const askRow = single && single.kind === 'file' ? single : null
  const askGate = askRow ? canAsk(askRow) : { ok: false as const, reason: undefined }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center" data-testid="row-toolbar">
      <div
        role="toolbar"
        aria-label="所选项目操作"
        className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-2 shadow-lg backdrop-blur-xl"
      >
        <span className="px-2 text-xs tabular-nums text-[var(--color-foreground)] opacity-80" data-testid="toolbar-count">
          已选 {selection.length} 项
        </span>
        <Button
          size="sm"
          variant="glass"
          disabled={!hasFile}
          title={hasFile ? undefined : '文件夹不可下载'}
          onClick={onDownload}
        >
          <Download size={14} />
          下载
        </Button>
        <Button
          size="sm"
          variant="glass"
          disabled={single === null}
          title={single === null ? '一次仅移动单个项目' : undefined}
          onClick={onMove}
        >
          <FolderInput size={14} />
          移动
        </Button>
        <Button
          size="sm"
          variant="glass"
          disabled={single === null}
          title={single === null ? '一次仅重命名单个项目' : undefined}
          onClick={onRename}
        >
          <Pencil size={14} />
          重命名
        </Button>
        {askRow ? (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="glass"
                  aria-disabled={askGate.ok ? undefined : 'true'}
                  onClick={() => {
                    if (askGate.ok) onAsk()
                  }}
                >
                  <Sparkles size={14} />
                  问 AI
                </Button>
              </TooltipTrigger>
              {!askGate.ok ? (
                <TooltipContent variant="glass" side="top">
                  {askGate.reason ?? '暂不支持问答。'}
                </TooltipContent>
              ) : null}
            </Tooltip>
          </TooltipProvider>
        ) : null}
        <Button size="sm" variant="glass" className="text-red-600 dark:text-red-400" onClick={onTrash}>
          <Trash2 size={14} />
          移入回收站
        </Button>
      </div>
    </div>
  )
}
