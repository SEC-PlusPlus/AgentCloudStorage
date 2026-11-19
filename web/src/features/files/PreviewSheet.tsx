// 预览 sheet（Task 10 / spec §5.2「预览」条目、brief §115）：右侧 vendored `sheet`（Radix dialog——
// 焦点陷阱/Esc/焦点回归/aria-labelledby 由 Radix 提供，SheetTitle=文件名自动关联 dialog 可及名）。
// 类型分支按 preview-kind.ts（旧 adbcfba previewTypes 逐条对照 + mime 双判）：
//   image/video → fetchFileContent 转 blob URL 进原生标签（blob 型别规范化见 Important-1 注）；
//   pdf → 同 blob URL 进 iframe；text → fetchTextPreview(512 KiB) + CodePanel + 截断徽标
//   （旧文案 adbcfba:630「文本较长，仅显示前 2 MiB。」额度换算随新上限 512 KiB）；
//   download-only → 不发内容请求，Mascot Empty + 直接下载。
// blob 型别（修复轮 1 / Important-1）：fetchFileContent 第二参走 resolveBlobContentType——
// contentType 为空/octet 时按旧 adbcfba mime 表规范化（octet blob 进 iframe/video Chromium 不内渲），
// 真实 type 原样采信。
// 旧版 >100 MiB 非 text 拒预览守卫（修复轮 1 / Important-2 复活：adbcfba:28,386-389 原文案逐字）：
// fetchFileContent 是 response.blob() 全量急切下载，守卫必须在发请求前——FileRow 已补 sizeBytes
// （mergeRows 本就拿 item.size）。size 恰等 100 MiB 放行（旧 `>` 等号原样）。
// blob URL 生命周期：generation 计数 + urlRef——row 切换/关闭/卸载走同一 effect cleanup revoke；
// 迟到响应（快速切换的行）gen 不匹配即弃用，其新建 URL 就地 revoke 防泄漏（评审 Focus 竞态用例钉死）。
// 取数效应挂 useLayoutEffect（修复轮 1 / Minor-3）：row 切换的 reset/守卫态在浏览器绘制前落定，
// 杜绝旧行内容在新行 loading 帧闪一现。
// 头部「问 AI」= Task 12 接线（评审 minor ⑮ 收尾）：canAsk.ok 启用直触 onAsk；不合格保持
// **aria-disabled + onClick 守卫**而非原生 disabled——理由：disabled 按钮吞掉 pointer/focus 事件，
// tooltip 的 reason 将无法被键盘与鼠标用户发现；vendored Radix tooltip（mode B 在列，d.ts 确认
// Trigger 支持 asChild 转发到 Button）承担说明呈现，替换旧 title 属性 hack。
import { useLayoutEffect, useRef, useState } from 'react'
import { Download, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/glinui/components/badge'
import { Button } from '@/components/glinui/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/glinui/components/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/glinui/components/tooltip'
import { canAsk } from '@/features/qa/qa-state'
import { CodePanel } from '@/components/app/CodePanel'
import { Empty } from '@/components/app/Empty'
import { downloadFile, fetchFileContent, fetchTextPreview, type FileItem } from '@/api/storage'
import { mutationErrorMessage } from './actions'
import { previewKind, resolveBlobContentType, type PreviewKind } from './preview-kind'
import type { FileRow } from './useFileRows'

/** brief 钉死：文本预览上限 512 KiB（旧版 2 MiB，新版收窄以压内存与滚动条体验）。 */
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024

/** 旧 adbcfba:28 `maxPreviewBytes = 100 * 1024 * 1024` 逐字——非 text 类型 blob 预览上限（Important-2）。 */
export const MAX_BLOB_PREVIEW_BYTES = 100 * 1024 * 1024

/** 旧守卫文案逐字（adbcfba:388）。 */
const OVERSIZE_PREVIEW_COPY = '文件超过 100 MiB，浏览器预览容易占用过多内存，请下载后查看。'

export interface PreviewSheetProps {
  /** null=关闭态；组件常驻挂载（FilesPage），由 row 引用变化驱动取数与释放。 */
  row: FileRow | null
  onClose(): void
  /** Task 12 问答接线：仅 canAsk.ok 的文件会触发（不合格=aria-disabled + tooltip reason）。 */
  onAsk(row: FileRow): void
}

interface PreviewState {
  kind: PreviewKind
  loading: boolean
  error: string
  /** error 是否为 >100 MiB 守卫态（true 时错误区附「直接下载」动作，Important-2）。 */
  oversize: boolean
  url: string
  text: string
  truncated: boolean
}

/** FileRow→FileItem 收窄 cast（Task 9 runDownload 同纪律：三个 api 仅读 id/original_name/content_type 由行携带）。 */
const toFileItem = (row: FileRow & { kind: 'file' }): FileItem =>
  ({ id: row.id, original_name: row.name }) as FileItem

export function PreviewSheet({ row, onClose, onAsk }: PreviewSheetProps) {
  const [state, setState] = useState<PreviewState | null>(null)
  const generationRef = useRef(0)
  const urlRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!row || row.kind !== 'file') {
      setState(null)
      return
    }
    const kind = previewKind(row.contentType, row.name)
    const generation = ++generationRef.current
    const blank = (patch: Partial<PreviewState>): PreviewState =>
      ({ kind, loading: false, error: '', oversize: false, url: '', text: '', truncated: false, ...patch })
    setState(blank({ loading: kind !== 'download-only' }))

    const isStale = () => generation !== generationRef.current
    const fail = (error: unknown) => {
      if (isStale()) return
      setState(blank({ error: mutationErrorMessage(error) }))
    }

    // Important-2 守卫先于任何请求：fetchFileContent=response.blob() 全量急切下载（storage.ts:83-86），
    // 超限大文件一旦发请求就已整读进内存。text 不受守卫（流式截断）、download-only 本就不取数。
    if (kind !== 'text' && kind !== 'download-only' && row.sizeBytes > MAX_BLOB_PREVIEW_BYTES) {
      setState(blank({ error: OVERSIZE_PREVIEW_COPY, oversize: true }))
      return
    }

    if (kind === 'text') {
      fetchTextPreview(toFileItem(row), TEXT_PREVIEW_MAX_BYTES)
        .then(async (result) => {
          const text = await result.blob.text()
          if (isStale()) return
          setState(blank({ text, truncated: result.truncated }))
        })
        .catch(fail)
    } else if (kind !== 'download-only') {
      // Important-1：octet/空 type 落库行按旧 mime 表规范化，否则 iframe/video 拿到 octet blob 不内渲
      fetchFileContent(toFileItem(row), resolveBlobContentType(row.contentType, row.name))
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          if (isStale()) {
            // 迟到的旧行响应：帧不覆盖当前画面，刚建的 blob URL 就地回收（防泄漏）
            URL.revokeObjectURL(url)
            return
          }
          urlRef.current = url
          setState(blank({ url }))
        })
        .catch(fail)
    }

    return () => {
      generationRef.current += 1 // 使一切在途响应作废（row 切换/关闭/卸载共用此清理通道）
      if (urlRef.current !== null) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [row])

  // 「问 AI」门控（Task 12）：与 QaSheet 内部同一 canAsk 判定源，reason 供 tooltip 呈现
  const askGate = row ? canAsk(row) : { ok: false as const, reason: undefined }
  const askEligible = askGate.ok
  const askReason = askGate.reason ?? '暂不支持问答。'

  const runDownload = async () => {
    if (!row || row.kind !== 'file') return
    try {
      await downloadFile(toFileItem(row))
      toast('下载已开始。') // 旧文案（FilesPage runDownload 同句）
    } catch (error) {
      toast.error(mutationErrorMessage(error))
    }
  }

  return (
    <Sheet open={row !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        variant="glass"
        size="lg"
        className="flex w-full max-w-xl flex-col gap-0 overflow-hidden"
      >
        {row ? (
          <>
            <SheetHeader className="border-b border-white/10 pb-3 dark:border-white/10">
              <span className="text-xs opacity-60">文件预览</span>{/* 旧 preview-kicker 文案 */}
              <SheetTitle className="truncate pr-8 text-left">{row.name}</SheetTitle>
              {/* Radix Dialog 缺 Description 会 dev 告警（测试 pristine 门）：sr-only 说明槽补位 */}
              <SheetDescription className="sr-only">文件内容预览</SheetDescription>
            </SheetHeader>
            <div className="flex items-center gap-2 px-6 pt-3">
              <Button variant="glass" size="sm" onClick={() => void runDownload()}>
                <Download size={14} /> 下载
              </Button>
              {/* Task 12 接线：canAsk（旧 :308 正则 ∧ 1 MiB 守卫）门控启用态 */}
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="glass"
                      size="sm"
                      aria-disabled={askEligible ? undefined : 'true'}
                      onClick={() => {
                        if (askEligible) onAsk(row)
                      }}
                    >
                      <Sparkles size={14} /> 问 AI
                    </Button>
                  </TooltipTrigger>
                  {!askEligible ? (
                    <TooltipContent variant="glass" side="bottom">
                      {askReason}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              </TooltipProvider>
              <Button variant="ghost" size="sm" onClick={onClose}>
                关闭
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-6 pb-6 pt-3">
              {state?.loading ? (
                <div role="status" className="p-6 text-sm opacity-70">
                  正在读取文件…
                </div>
              ) : state?.error ? (
                <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
                  <p>{state.error}</p>
                  {/* Important-2：旧错误态带出口——超限场景在文案旁附下载动作（旧 adbcfba:627 错误态含按钮语义的等价承接） */}
                  {state.oversize ? (
                    <Button variant="glass" size="sm" onClick={() => void runDownload()}>
                      直接下载
                    </Button>
                  ) : null}
                </div>
              ) : state ? (
                <>
                  {state.kind === 'image' ? (
                    <img src={state.url} alt={row.name} className="min-h-0 w-full flex-1 object-contain" />
                  ) : state.kind === 'video' ? (
                    <video src={state.url} controls aria-label={`预览 ${row.name}`} className="min-h-0 w-full flex-1 bg-black/40" />
                  ) : state.kind === 'pdf' ? (
                    <iframe src={state.url} title={`预览 ${row.name}`} className="min-h-0 flex-1 rounded-lg border border-white/15 bg-white/5" />
                  ) : state.kind === 'text' ? (
                    <>
                      {state.truncated ? (
                        <p className="flex items-center gap-2 text-xs opacity-80">
                          {/* 旧文案「文本较长，仅显示前 2 MiB。」（adbcfba:630）——额度换算随新版 512 KiB 上限 */}
                          <Badge variant="warning" size="sm">已截断</Badge>
                          文本较长，仅显示前 512 KiB。
                        </p>
                      ) : null}
                      <CodePanel title={row.name} value={state.text} />
                    </>
                  ) : (
                    <Empty
                      title="该文件暂不支持在线预览"
                      description="类型不在预览白名单内，可直接下载到本地查看。"
                      action={{ label: '直接下载', onClick: () => void runDownload() }}
                    />
                  )}
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
