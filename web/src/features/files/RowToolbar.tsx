// 选择浮动操作条（Task 9；Task 2-B abc-4 收窄）：**多选专属**批量载体——selection.length<2 时
// 不渲染（单选由右栏 DetailPanel 承载全部动作，浮条与面板不再双写单目标动作）。位置仍在 Dock
// 之上（Dock 固定 bottom-4 z-40，本条 bottom-24 同层级居中，pointer-events 分内外层=Dock 同款技术）。
// 批量语义沿用 Task 9 裁定：下载仅作用于所选中文件行（混选中只下载文件部分）；移入回收站可多选
// （文件夹=删除空目录语义，非空报错文案由服务端 translateError 呈现）。
// 移动/重命名/问 AI（单目标语义）已从本条整体移除——多选下恒禁用=死钮（abc-4：条只留批量，
// 单目标动作唯一入口=DetailPanel/右键菜单），disabled 占位不保留。
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/glinui/components/button'
import type { FileRow } from './useFileRows'

export interface RowToolbarProps {
  selection: FileRow[]
  onDownload(): void
  onTrash(): void
}

export function RowToolbar({ selection, onDownload, onTrash }: RowToolbarProps) {
  if (selection.length < 2) return null
  const hasFile = selection.some((row) => row.kind === 'file')

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
        <Button size="sm" variant="glass" className="text-red-600 dark:text-red-400" onClick={onTrash}>
          <Trash2 size={14} />
          移入回收站
        </Button>
      </div>
    </div>
  )
}
