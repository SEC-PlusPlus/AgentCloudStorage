// self-build — TODO(Task 13 swap to glinui registry attachment)
// 上传队列行（Task 8）：名称 + 大小 + 百分比条（vendored Progress）+ 状态文案 + 取消/重试。
// 对应旧版 upload-progress 区块（FileWorkbench.vue 模板 486-490：name/status 文本/percent/取消按钮），
// 「合并阶段不可取消」的旧 544 行规则落到 UI：merging 不渲染取消按钮（runUpload 层本就忽略信号，双保险）。
import { Button } from '@/components/glinui/components/button'
import { Progress } from '@/components/glinui/components/progress'
import { formatBytes } from '@/lib/format'
import type { UploadTask, UploadTaskStatus } from '@/lib/uploads'

const STATUS_TEXT: Record<UploadTaskStatus, string> = {
  queued: '排队中',
  uploading: '上传中',
  merging: '正在合并',
  done: '已完成',
  failed: '上传失败',
  cancelled: '已取消',
}

export interface AttachmentProps {
  task: UploadTask
  onCancel(): void
  onRetry(): void
}

export function Attachment({ task, onCancel, onRetry }: AttachmentProps) {
  const canCancel = task.status === 'queued' || task.status === 'uploading'
  const canRetry = task.status === 'failed' || task.status === 'cancelled'
  const showPercent = task.status === 'uploading' || task.status === 'merging' || task.status === 'done'
  return (
    <div
      data-testid="attachment"
      className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/5 p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-[var(--color-foreground)]" title={task.name}>
          {task.name}
        </span>
        <span className="shrink-0 text-xs text-[var(--color-foreground)] opacity-70">
          {formatBytes(task.size)}
        </span>
      </div>
      <Progress
        value={task.percent}
        variant="glass"
        size="sm"
        aria-label={`${task.name} 上传进度`}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-foreground)]">
        {/* 状态文本承载旧版 aria-live 播报的内容本身（live 区域在 UploadQueuePanel 层） */}
        <span className="min-w-0 truncate">
          {STATUS_TEXT[task.status]}
          {showPercent ? ` · ${task.percent}%` : ''}
          {task.error ? `：${task.error}` : ''}
        </span>
        <span className="flex shrink-0 gap-1">
          {canCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              取消
            </Button>
          ) : null}
          {canRetry ? (
            <Button size="sm" variant="glass" onClick={onRetry}>
              重试
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  )
}
