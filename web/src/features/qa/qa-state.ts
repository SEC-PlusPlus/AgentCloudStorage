// 文件问答状态层（Task 12 / spec §5.3:118）：旧 FileWorkbench.vue（adbcfba）内联 ask 面板语义 1:1 移植。
// 判定源钉死：canAsk = 旧 :308 正则 /\.(txt|md)$/i ∧ 旧 :350 发送守卫 `!(size > 1 << 20)`——
// **不复用 preview-kind 的 TEXT_PREVIEW_KINDS**（T10 修复轮 Minor-5：预览 text 集含 log/csv，
// 旧问答白名单更窄）；字节数走 FileRow.sizeBytes（T10 Important-2 上行，勿再取 sizeText 反推）。
// reason 文案：超限走旧 :614 hint 逐字；「非 TXT/MD」旧版无拒绝文案（旧靠 v-if 隐藏入口 :597），
// 本条按旧 intro（:608「支持 UTF-8 的 TXT / Markdown」）口径新拟——报告已标注为新拟文案。
import type { FileRow } from '@/features/files/useFileRows'

/** brief 钉死的轮模型：failed 标记驱动「重试」动作。 */
export type QaTurn = { role: 'user' | 'assistant'; text: string; failed?: boolean }

export const QA_MAX_ASK_BYTES = 1 << 20
export const QA_MAX_QUESTION_LENGTH = 500

// —— 旧文案逐字表（adbcfba FileWorkbench.vue 行号注记）——
/** 旧 :608 ask-intro。 */
export const QA_INTRO_COPY = '只根据这份文件回答。支持 UTF-8 的 TXT / Markdown，回答中的 [数字] 对应文件段落。'
/** 旧 :611 placeholder 逐字。 */
export const QA_PLACEHOLDER_COPY = '例如：这份资料的主要结论是什么？'
/** 旧 :610 label 逐字。 */
export const QA_LABEL_COPY = '你的问题'
/** 旧 :611 发送按钮文本逐字。 */
export const QA_SEND_COPY = '发送问题'
/** 旧 :606 标题区逐字。 */
export const QA_TITLE_COPY = '向文件提问'
export const QA_KICKER_COPY = '资料问答'
/** 旧 :606 关闭按钮 aria-label 逐字。 */
export const QA_CLOSE_ARIA_COPY = '关闭问答'
/** 旧 :616 工作状态文案逐字。 */
export const QA_THINKING_COPY = '正在从文件中寻找回答…'
/** 旧 :617 答案区注脚逐字。 */
export const QA_CITATION_NOTE_COPY = '引用编号由模型生成，请对照原文件核查重要信息。'
/** 旧 :614 超限 hint（role=alert）逐字——兼作 canAsk 超限 reason。 */
export const QA_OVERSIZE_HINT_COPY = '此文件超过 1 MiB，暂不支持问答。'
/** 旧 :365 ApiError 500 专属文案逐字。 */
export const QA_SERVER_ERROR_COPY = '问答失败。请确认文件为较短的 UTF-8 文本，或稍后重试。'
/** 旧 :361 空回答兜底逐字。 */
export const QA_EMPTY_ANSWER_COPY = '模型没有返回回答，请重试。'
/** 旧 :349 空问题守卫逐字（新版按钮 disabled + IME 门已挡常规路径，此处兜底）。 */
export const QA_EMPTY_QUESTION_COPY = '先输入一个问题。'
/** 新拟：旧版对不合格类型直接隐藏入口、无拒绝文案；reason 按旧 intro 口径。 */
export const QA_TYPE_UNSUPPORTED_COPY = '暂不支持问答，仅支持 TXT / Markdown 文件。'
/** 新拟：busy 时发送位换「停止回答」（abort 为 brief 钉死的新增能力，旧版无此按钮）。 */
export const QA_STOP_COPY = '停止回答'

/** 旧 adbcfba:308 canAsk 正则逐字。 */
const ASKABLE_NAME_RE = /\.(txt|md)$/i

export interface AskEligibility {
  ok: boolean
  reason?: string
}

/** 行可问答性：文件夹恒拒 → 类型正则 → 1 MiB 守卫（先类型后大小，reason 稳定可测）。 */
export function canAsk(row: FileRow): AskEligibility {
  if (row.kind !== 'file' || !ASKABLE_NAME_RE.test(row.name)) {
    return { ok: false, reason: QA_TYPE_UNSUPPORTED_COPY }
  }
  if (row.sizeBytes > QA_MAX_ASK_BYTES) {
    return { ok: false, reason: QA_OVERSIZE_HINT_COPY }
  }
  return { ok: true }
}

/**
 * 纯追加（不可变）。两条重试语义规则（brief Step 1「失败轮重试不重复计入」）：
 * ① 尾部 failed assistant + 新 assistant 轮 → **替换**（重试结果接管失败气泡原位；
 *    再失败则同样替换，annotate 最新错误而不堆叠）；
 * ② 同文本连续 user 轮 → no-op 原样返回（重试路径 QaSheet 不重发用户轮，此条为双保险，
 *    杜绝「停止后原问重提交」产生双气泡）。
 * 非重试场景（failed 后问新问题）两条规则均不触发，失败气泡保留原位供回看。
 */
export function appendTurn(list: QaTurn[], turn: QaTurn): QaTurn[] {
  const last = list.length > 0 ? list[list.length - 1] : undefined
  if (turn.role === 'user' && last && last.role === 'user' && last.text === turn.text) return list
  if (turn.role === 'assistant' && last && last.role === 'assistant' && last.failed) {
    return [...list.slice(0, -1), turn]
  }
  return [...list, turn]
}
