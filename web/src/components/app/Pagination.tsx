// self-build — TODO(Task 13 swap to glinui registry <pagination>)
// 服务端分页条（Task 7：后端每页 20 条、无排序参数，pagination 只管页码而非行虚拟化）。
// 纯受控展示件：page/pageSize/total 全由调用方（URL searchParams）注入，本件无内部状态。
// 键盘可达：全部动作走原生 <button>（Tab 聚焦 / Enter/Space 激活），当前页 aria-current="page"。
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/components/glinui/lib/cn'

export interface PaginationProps {
  page: number
  /** 默认与服务端 page_size=20 对齐。 */
  pageSize?: number
  total: number
  onChange: (page: number) => void
  disabled?: boolean
  className?: string
}

const GAP = '…' as const

/** 页码窗口：首尾恒显，当前页 ±1，其余折叠为省略号。返回渲染序（GAP 占位）。 */
export function pageItems(current: number, pageCount: number): (number | typeof GAP)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const wanted = new Set<number>([1, pageCount])
  for (let p = current - 1; p <= current + 1; p++) if (p >= 1 && p <= pageCount) wanted.add(p)
  const sorted = [...wanted].sort((a, b) => a - b)
  const out: (number | typeof GAP)[] = []
  let prev = 0
  for (const p of sorted) {
    if (prev > 0 && p - prev > 1) out.push(GAP)
    out.push(p)
    prev = p
  }
  return out
}

export function Pagination({ page, pageSize = 20, total, onChange, disabled = false, className }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pageCount) // 深链 ?page=999 兜底钳位（翻页按钮态正确）
  const go = (next: number) => {
    if (disabled || next < 1 || next > pageCount || next === current) return
    onChange(next)
  }

  return (
    <nav
      aria-label="分页"
      data-testid="pagination"
      className={cn('flex flex-wrap items-center justify-center gap-1.5 py-3', className)}
    >
      <span className="mr-2 text-xs text-[var(--color-foreground)] opacity-70">共 {total} 条 · 第 {current}/{pageCount} 页</span>
      <button
        type="button"
        aria-label="上一页"
        disabled={disabled || current <= 1}
        onClick={() => go(current - 1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors duration-200 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft size={16} />
      </button>
      {pageItems(current, pageCount).map((item, index) =>
        item === GAP ? (
          <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-sm opacity-60">
            {GAP}
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-label={`第 ${item} 页`}
            aria-current={item === current ? 'page' : undefined}
            disabled={disabled || item === current}
            onClick={() => go(item)}
            className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-2 text-sm transition-colors duration-200 hover:bg-white/10 aria-[current=page]:border-[var(--color-accent)]/40 aria-[current=page]:bg-[var(--color-accent)]/20 disabled:pointer-events-none disabled:opacity-40"
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="下一页"
        disabled={disabled || current >= pageCount}
        onClick={() => go(current + 1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors duration-200 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  )
}
