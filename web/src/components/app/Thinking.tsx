// self-build — TODO(Task 13 swap to glinui registry thinking)
// 三点跳动占位（PATH B registry 无件；manifest SELF-BUILT 名单）。
// T13 carry #21b（Task 12 评审 A2，Approved 防御项）：原 role=status 嵌在 MessageScroller 的
// role=log live region 内——嵌套 live region 双报/触发歧义，外层 log 已对占位上/下屏播报；
// 改 aria-hidden 纯装饰，回答轮到达时由 log 播报正文。
// 动画走 Tailwind animate-bounce + 静态 animation-delay 类（模板串类名 Tailwind JIT 不生成），
// motion-reduce 变体 = prefers-reduced-motion 降级为静态三点（不依赖 JS 查询）。
import { cn } from '@/components/glinui/lib/cn'

const DOT_DELAY_CLASS = ['[animation-delay:0ms]', '[animation-delay:120ms]', '[animation-delay:240ms]']

export interface ThinkingProps {
  /** 状态文案（QaSheet 注入旧 :616「正在从文件中寻找回答…」逐字）。 */
  label?: string
  className?: string
}

export function Thinking({ label = '思考中…', className }: ThinkingProps) {
  return (
    <div aria-hidden="true" className={cn('flex items-center gap-2 px-1 py-2 text-sm opacity-70', className)}>
      <span aria-hidden="true" className="flex items-center gap-1">
        {DOT_DELAY_CLASS.map((delay, index) => (
          <span
            key={index}
            className={cn('size-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none', delay)}
          />
        ))}
      </span>
      <span>{label}</span>
    </div>
  )
}
