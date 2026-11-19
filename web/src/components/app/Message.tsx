// self-build — TODO(Task 13 swap to glinui registry message / bubble)
// 对话行（PATH B registry 无件）：Bubble=角色化气泡外观（user 右/glass 面、assistant 左/弱面），
// Message=Bubble + 失败态（旧 ask-error role=alert 语义上气泡：红调 + 「重试」动作上抛原问题）。
// 「重试」按钮为 brief 钉死的新能力（旧版 500 后只能手动重敲），文案「重试」新拟（旧版无重试件）。
import type { ReactNode } from 'react'
import { Button } from '@/components/glinui/components/button'
import { cn } from '@/components/glinui/lib/cn'

export interface BubbleProps {
  role: 'user' | 'assistant'
  className?: string
  children: ReactNode
}

export function Bubble({ role, className, children }: BubbleProps) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl border px-3.5 py-2 text-sm',
          // 外观对齐既有 glass 面纪律（bg-white/5~10 + border-white/10~20，Attachment/Dock 同款）
          isUser ? 'border-white/20 bg-white/10' : 'border-white/10 bg-white/5',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export interface MessageProps {
  role: 'user' | 'assistant'
  text: string
  failed?: boolean
  /** failed 轮的重试上下文（该轮对应的原问题；QaSheet 由轮列表回溯推得）。 */
  retryQuestion?: string
  onRetry?(question: string): void
}

export function Message({ role, text, failed = false, retryQuestion, onRetry }: MessageProps) {
  return (
    <Bubble role={role} className={cn('whitespace-pre-wrap break-words', failed && 'border-red-500/40 bg-red-500/10')}>
      {failed ? (
        // 旧 ask-error `role="alert"`（adbcfba:615）语义随轮上屏
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-red-600 dark:text-red-400">{text}</p>
          {retryQuestion && onRetry ? (
            <div>
              <Button variant="glass" size="sm" onClick={() => onRetry(retryQuestion)}>
                重试
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p>{text}</p>
      )}
    </Bubble>
  )
}
