// self-build — TODO(Task 13 swap to glinui registry code-panel)
// 最小文本展示面板（spec §11 SELF-BUILT 名单内 code-panel，PATH B registry 无件）：
// header bar（标题槽）+ `pre > code` 滚动 well。按任务裁定**不做手搓语法高亮**
// （tok-* 类名一并省略——Task 13 换 registry 件时由其提供着色与行号）。
import { cn } from '@/components/glinui/lib/cn'

export interface CodePanelProps {
  /** 头部栏标题（通常为文件名）。 */
  title?: string
  value: string
  className?: string
}

export function CodePanel({ title, value, className }: CodePanelProps) {
  return (
    <div
      data-testid="code-panel"
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/15 bg-black/20',
        'dark:border-white/10',
        className,
      )}
    >
      {/* header bar：外观类对齐 vendored floating-panel 头部纪律（细字 muted + 分隔线） */}
      <div className="flex items-center justify-between gap-2 border-b border-white/15 px-3 py-2 text-xs text-[var(--color-foreground)] opacity-70 dark:border-white/10">
        <span className="truncate">{title ?? '代码'}</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5 text-[var(--color-foreground)]">
        <code>{value}</code>
      </pre>
    </div>
  )
}
