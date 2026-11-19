// self-build — TODO(Task 13 swap to glinui registry <empty>)
// 空态骨架（spec §11 兜底：registry-only 件 PATH B 无）：mascot 图 + title/description/action 三槽。
// 无障碍：容器 role="status"（polite 播报「空了」），mascot 为装饰性 alt=""。
// T13 carry #9（Task 7 minor「live region 挂载时机」，记录性跳过）：status 容器随 Empty 同挂载/同卸载，
// 「挂载即有文案」部分 AT 不播报——常驻化需把 live region 提升到路由外全局壳层（组件契约改动、
// 播报内容归属会跨页串扰），收益不确定，本轮不动结构，按评审原话备案。
import type { ReactNode } from 'react'
import { Heading } from '@/components/glinui/components/heading'
import { Text } from '@/components/glinui/components/text'
import { cn } from '@/components/glinui/lib/cn'

// 素材：web/public/images/cloud-gopher-pixel.png（登记见 docs/asset-credits.md，用途含「空态」）
export const EMPTY_MASCOT_SRC = '/images/cloud-gopher-pixel.png'

export interface EmptyProps {
  title: string
  description?: string
  /** 可选动作文案（如「清除搜索」）；行为由调用方闭包决定。 */
  action?: { label: string; onClick: () => void }
  imageSrc?: string
  className?: string
  children?: ReactNode
}

export function Empty({ title, description, action, imageSrc = EMPTY_MASCOT_SRC, className, children }: EmptyProps) {
  return (
    <div
      data-testid="empty"
      className={cn('flex flex-col items-center justify-center gap-4 px-6 py-20 text-center', className)}
    >
      <img
        src={imageSrc}
        alt=""
        aria-hidden="true"
        width={96}
        className="h-24 w-auto [image-rendering:pixelated] opacity-90"
      />
      <Heading level={3} size="sm" className="opacity-90">
        {title}
      </Heading>
      {/* role=status：标题/描述变化即礼貌播报（空态判定在调用方切换文案时触发） */}
      <div role="status" className="flex flex-col items-center gap-1">
        {description ? <Text variant="muted" size="sm">{description}</Text> : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-[var(--color-foreground)] transition-colors duration-200 hover:bg-white/10"
        >
          {action.label}
        </button>
      ) : null}
      {children}
    </div>
  )
}
