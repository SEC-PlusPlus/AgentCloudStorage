// 文件问答 sheet（Task 12 / spec §5.3:118）：右侧 vendored `sheet` 承载多轮对话（旧 adbcfba 内联
// ask 面板的单轮问答模型升级为 MessageScroller 对话流——文案/守卫语义仍逐字承接，见 qa-state 文案表）。
// 生命周期裁定（plan-simplicity）：对话状态活在组件实例内——关闭 sheet = 卸载 = 清空（brief「cleared
// on close」）；FilesPage 以 qaRow=null 卸载实现，切换文件天然新对话。
// abort 接线（**plan-sanctioned 新增**：旧版无 stop、关闭仅 generation++ 作废响应）：
// ① 卸载（关闭/离开对话）abort 在途 askFile——signal.aborted 的结果静默丢弃，语义对齐旧 :360/:363；
// ② busy 时发送位换「停止回答」，同走 abort 通道，不产生 failed 轮（用户主动取消≠服务失败）。
// 重试语义（brief「失败轮重试不重复计入」）：retry 不追加用户轮，结果经 appendTurn 替换尾部 failed 气泡。
// 500 专属文案（旧 :365 逐字）之外的错误走 mutationErrorMessage（旧 apiMessage 的新版等价载体）。
import { useEffect, useRef, useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/glinui/components/sheet'
import { Button } from '@/components/glinui/components/button'
import { MessageScroller } from '@/components/app/MessageScroller'
import { Message } from '@/components/app/Message'
import { PromptInput } from '@/components/app/PromptInput'
import { Thinking } from '@/components/app/Thinking'
import { ApiError } from '@/api/client'
import { askFile } from '@/api/knowledge'
import { mutationErrorMessage } from '@/features/files/actions'
import {
  QA_CITATION_NOTE_COPY,
  QA_EMPTY_ANSWER_COPY,
  QA_EMPTY_QUESTION_COPY,
  QA_INTRO_COPY,
  QA_KICKER_COPY,
  QA_LABEL_COPY,
  QA_MAX_QUESTION_LENGTH,
  QA_PLACEHOLDER_COPY,
  QA_SEND_COPY,
  QA_SERVER_ERROR_COPY,
  QA_STOP_COPY,
  QA_THINKING_COPY,
  QA_TITLE_COPY,
  QA_CLOSE_ARIA_COPY,
  appendTurn,
  canAsk,
} from './qa-state'
import type { QaTurn } from './qa-state'
import type { FileRow } from '@/features/files/useFileRows'

export interface QaSheetProps {
  /** brief 钉死签名：sheet 打开期间 row 恒定（换文件=父层先卸载），故不留 null 分支。 */
  row: FileRow
  open: boolean
  onClose(): void
}

export function QaSheet({ row, open, onClose }: QaSheetProps) {
  const [turns, setTurns] = useState<QaTurn[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  /** 常规提交路径已被 disabled 挡死；保留旧 :349 守卫文案兜底非按钮提交通道。 */
  const [preflightError, setPreflightError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  // 关闭/卸载 = abort 在途问答（plan-sanctioned 新增，见头注）
  useEffect(
    () => () => {
      controllerRef.current?.abort()
      controllerRef.current = null
    },
    [],
  )

  const eligibility = canAsk(row)

  async function runAsk(asked: string) {
    const controller = new AbortController()
    controllerRef.current = controller
    setPending(true)
    try {
      const result = await askFile(row.id, asked, controller.signal)
      if (controller.signal.aborted) return // 半途关闭/停止：静默弃用（旧 generation 守卫语义）
      setTurns((list) =>
        appendTurn(list, { role: 'assistant', text: result.answer.trim() || QA_EMPTY_ANSWER_COPY }),
      )
    } catch (error) {
      if (controller.signal.aborted) return
      const message =
        error instanceof ApiError && error.status === 500 ? QA_SERVER_ERROR_COPY : mutationErrorMessage(error)
      setTurns((list) => appendTurn(list, { role: 'assistant', text: message, failed: true }))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setPending(false)
      }
    }
  }

  function submit() {
    const asked = question.trim()
    if (!asked) {
      setPreflightError(QA_EMPTY_QUESTION_COPY)
      return
    }
    if (!eligibility.ok) return // 入口已按 canAsk 禁用；此为直接提交的最后防线（旧 :350 守卫位）
    setPreflightError('')
    setTurns((list) => appendTurn(list, { role: 'user', text: asked }))
    setQuestion('')
    void runAsk(asked)
  }

  function retry(asked: string) {
    if (pending) return
    // 不追加用户轮——appendTurn 以新 assistant 轮替换尾部 failed 气泡
    void runAsk(asked)
  }

  function stop() {
    controllerRef.current?.abort()
    controllerRef.current = null
    setPending(false)
  }

  /** failed 轮的重试上下文：向前回溯最近一条 user 轮。 */
  function questionBefore(index: number): string | undefined {
    for (let i = index - 1; i >= 0; i -= 1) {
      const turn = turns[i]
      if (turn && turn.role === 'user') return turn.text
    }
    return undefined
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        variant="glass"
        size="lg"
        className="flex w-full max-w-xl flex-col gap-0 overflow-hidden"
      >
        <SheetHeader className="border-b border-white/10 pb-3 dark:border-white/10">
          <span className="text-xs opacity-60">{QA_KICKER_COPY}</span>
          <SheetTitle className="truncate pr-8 text-left">{QA_TITLE_COPY}</SheetTitle>
          <SheetDescription className="truncate">{row.name}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-2 px-6 pt-3">
          <Button variant="ghost" size="sm" aria-label={QA_CLOSE_ARIA_COPY} onClick={onClose}>
            {QA_CLOSE_ARIA_COPY}
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-6 pb-4 pt-2">
          <p className="text-xs opacity-70">{QA_INTRO_COPY}</p>
          {!eligibility.ok ? (
            // 旧 :614 hint 位（role=alert）——reason 逐字（超限=旧文案；类型=新拟口径）
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {eligibility.reason}
            </p>
          ) : null}
          <MessageScroller turnCount={turns.length + (pending ? 1 : 0)}>
            {turns.map((turn, index) => (
              <Message
                key={`${index}-${turn.role}`}
                role={turn.role}
                text={turn.text}
                failed={turn.failed}
                retryQuestion={turn.failed ? questionBefore(index) : undefined}
                onRetry={retry}
              />
            ))}
            {pending ? <Thinking label={QA_THINKING_COPY} /> : null}
          </MessageScroller>
          <p className="text-xs opacity-60">{QA_CITATION_NOTE_COPY}</p>
          {preflightError ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {preflightError}
            </p>
          ) : null}
          <PromptInput
            value={question}
            onChange={setQuestion}
            onSubmit={submit}
            onStop={stop}
            busy={pending}
            eligible={eligibility.ok}
            maxLength={QA_MAX_QUESTION_LENGTH}
            placeholder={QA_PLACEHOLDER_COPY}
            label={QA_LABEL_COPY}
            sendLabel={QA_SEND_COPY}
            stopLabel={QA_STOP_COPY}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
