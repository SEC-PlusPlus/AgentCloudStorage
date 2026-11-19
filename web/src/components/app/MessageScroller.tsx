// self-build — TODO(Task 13 swap to glinui registry message-scroller)
// 对话滚动容器（PATH B registry 无件）：role=log + aria-live=polite（brief：新 assistant 轮播报）。
// 贴底纪律（钉死数学见 shouldStickToBottom 单测）：**仅当此前已在底部附近**才随新内容自动滚底——
// stickRef 记住滚动条意图（scroll 事件更新），上滚翻阅历史时新消息不抢位，浮出「跳到最新」。
// 「跳到最新」为新版新增便利件（旧 ask 面板为单轮一问，无对话滚动概念）。
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/glinui/components/button'
import { cn } from '@/components/glinui/lib/cn'

/** 距底阈值（px）：≤ 视为「已在底部附近」。 */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 80

/** 纯判定：`scrollHeight - scrollTop - clientHeight <= threshold`（0 高度=贴底，jsdom/短内容天然成立）。 */
export function shouldStickToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export interface MessageScrollerProps {
  /** 内容代次计数（轮数 + pending 占位）：变化时执行贴底跟进。 */
  turnCount: number
  children: ReactNode
  className?: string
}

export function MessageScroller({ turnCount, children, className }: MessageScrollerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [turnCount])

  const handleScroll = () => {
    const el = ref.current
    if (!el) return
    const stick = shouldStickToBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
    stickRef.current = stick
    setShowJump(!stick)
  }

  const jumpToLatest = () => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickRef.current = true
    setShowJump(false)
  }

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      <div
        ref={ref}
        role="log"
        aria-live="polite"
        aria-label="问答对话"
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
      >
        {children}
      </div>
      {showJump ? (
        <Button
          variant="glass"
          size="sm"
          className="absolute bottom-2 left-1/2 -translate-x-1/2"
          onClick={jumpToLatest}
        >
          <ArrowDown size={14} /> 跳到最新
        </Button>
      ) : null}
    </div>
  )
}
