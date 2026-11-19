// self-build — TODO(Task 13 swap to glinui registry prompt-input)
// 问答输入区（PATH B registry 无件）：受控 textarea（rows 1 自动增高、scrollHeight 驱动、封顶夹住）+
// 旧 :611 语义逐字承接：placeholder/maxlength 500/实时计数「N / 500」/busy 禁输入/提交条件
// 「trim 非空 ∧ eligible」。IME 门（brief 钉死）：组合期 Enter 绝不提交——双通道判定
// （compositionstart/end 记忆 ref + nativeEvent.isComposing 旗标兜底），Shift+Enter 保留原生换行。
// 「停止回答」按钮为 brief 钉死的新能力（send/stop 槽位；旧版无 stop，abort 仅随面板关闭）。
import { useEffect, useRef } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/glinui/components/button'
import { cn } from '@/components/glinui/lib/cn'

/** 自动增高上限：超过转内部滚动（≈4 行，旧版固定 :rows="3" 的多轮化替代——brief「rows 1→max」）。 */
export const PROMPT_MAX_HEIGHT_PX = 160

export interface PromptInputProps {
  value: string
  onChange(value: string): void
  onSubmit(): void
  onStop?(): void
  /** 在途问答：输入禁用（旧 :611 `:disabled="askBusy"`）+ 发送位换停止。 */
  busy?: boolean
  /** 文件可问答性（canAsk.ok）：不合格禁输入禁提交（旧超限禁提交语义的类型扩展）。 */
  eligible?: boolean
  maxLength?: number
  placeholder?: string
  /** 视觉 label 文案（旧 :610「你的问题」逐字）。 */
  label?: string
  sendLabel?: string
  stopLabel?: string
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  eligible = true,
  maxLength = 500,
  placeholder = '',
  label = '你的问题',
  sendLabel = '发送问题',
  stopLabel = '停止回答',
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const canSubmit = !busy && eligible && value.trim() !== ''

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, PROMPT_MAX_HEIGHT_PX)}px`
  }, [value])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (composingRef.current || event.nativeEvent.isComposing) return // IME 组合期吞掉 Enter
    event.preventDefault()
    if (canSubmit) onSubmit()
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3">
      <label htmlFor="qa-prompt" className="text-xs opacity-70">
        {label}
      </label>
      <textarea
        id="qa-prompt"
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={busy || !eligible}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        className={cn(
          'w-full resize-none rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm',
          'text-[var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
          'disabled:opacity-50 dark:border-white/10',
        )}
      />
      <div className="flex items-center justify-between gap-2">
        {/* 旧 :611 计数格式逐字「{{ askQuestion.length }} / 500」——原始长度非 trim 长度 */}
        <span className="text-xs tabular-nums opacity-70">{`${value.length} / ${maxLength}`}</span>
        {busy ? (
          <Button variant="glass" size="sm" onClick={onStop}>
            <Square size={14} /> {stopLabel}
          </Button>
        ) : (
          <Button size="sm" disabled={!canSubmit} onClick={onSubmit}>
            <Send size={14} /> {sendLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
