// Task 10 预览 sheet 行为锚（jsdom，api 三函数整体 stub）：四类型分支渲染、text 截断徽标+旧文案、
// blob URL 生命周期（row 切换/关闭/卸载 revoke）、迟到响应竞态丢弃（评审 Focus：快速切换不留脏帧）、
// 头部操作（下载=downloadFile 单发+旧 toast；问 AI 禁用占位=评审 minor ⑮：disabled+aria-disabled+title+
// 文案提示槽，Radix tooltip 打磨留 Task 12）；⑭ 键盘入口：FilesTable 文件名按钮 focus+Enter 触发 onPreview。
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster, toast } from 'sonner'
import type { FileItem } from '@/api/storage'
import { downloadFile, fetchFileContent, fetchTextPreview } from '@/api/storage'
import { FilesTable } from './FilesTable'
import { PreviewSheet } from './PreviewSheet'
import type { FileRow } from './useFileRows'

vi.mock('@/api/storage', () => ({
  fetchFileContent: vi.fn(),
  fetchTextPreview: vi.fn(),
  downloadFile: vi.fn(),
}))

const IMG_ROW: FileRow = { kind: 'file', id: 1, name: 'photo.png', sizeText: '1 KiB', dateText: '2026-01-01', contentType: 'image/png' }
const IMG_ROW_B: FileRow = { ...IMG_ROW, id: 2, name: 'photo2.png' }
const VIDEO_ROW: FileRow = { kind: 'file', id: 3, name: 'clip.mp4', sizeText: '9 MiB', dateText: '2026-01-01', contentType: 'application/octet-stream' }
const PDF_ROW: FileRow = { kind: 'file', id: 4, name: 'doc.pdf', sizeText: '2 MiB', dateText: '2026-01-01', contentType: 'application/pdf' }
const TEXT_ROW: FileRow = { kind: 'file', id: 5, name: 'notes.md', sizeText: '3 KiB', dateText: '2026-01-01', contentType: 'text/plain' }
const BIN_ROW: FileRow = { kind: 'file', id: 6, name: 'archive.zip', sizeText: '40 MiB', dateText: '2026-01-01', contentType: 'application/octet-stream' }

// vi.mocked 句柄：工厂桩的导出仍是真实签名类型，mock 操作经 vi.mocked 取回 Mock 型（shell.test 同纪律）
const fetchFileContentMock = vi.mocked(fetchFileContent)
const fetchTextPreviewMock = vi.mocked(fetchTextPreview)
const downloadFileMock = vi.mocked(downloadFile)

const onClose = vi.fn()
const onAsk = vi.fn()
let revokeSpy: ReturnType<typeof vi.fn>
let urlCounter = 0

function renderSheet(row: FileRow | null) {
  return render(
    <>
      <PreviewSheet row={row} onClose={onClose} onAsk={onAsk} />
      <Toaster />
    </>,
  )
}

beforeEach(() => {
  onClose.mockClear()
  onAsk.mockClear()
  fetchFileContentMock.mockReset()
  fetchTextPreviewMock.mockReset()
  downloadFileMock.mockReset()
  urlCounter = 0
  // jsdom 无 createObjectURL——桩为可区分序列（actions-flow 下载用例同纪律，counter 供竞态/释放断言）
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:mock-${++urlCounter}`),
  })
  revokeSpy = vi.fn()
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeSpy })
  fetchFileContentMock.mockImplementation((item: FileItem) =>
    Promise.resolve(new Blob([`bytes-${item.id}`], { type: 'image/png' })),
  )
  fetchTextPreviewMock.mockImplementation(() =>
    Promise.resolve({ blob: new Blob(['正文内容'], { type: 'text/plain' }), truncated: false }),
  )
  downloadFileMock.mockResolvedValue(undefined)
})

afterEach(() => {
  toast.dismiss()
  cleanup()
  vi.restoreAllMocks()
})

describe('PreviewSheet：四类型分支', () => {
  it('image：dialog 以文件名命名，img src=blob:*，fetchFileContent 携 row.contentType 型别覆盖', async () => {
    renderSheet(IMG_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    const img = (await within(dialog).findByRole('img')) as HTMLImageElement
    expect(img.src).toMatch(/^blob:mock-/)
    expect(img).toHaveAttribute('alt', 'photo.png')
    await waitFor(() =>
      expect(fetchFileContent).toHaveBeenCalledWith({ id: 1, original_name: 'photo.png' }, 'image/png'),
    )
    expect(fetchTextPreview).not.toHaveBeenCalled()
  })

  it('video：原生 video 控件 + blob src', async () => {
    renderSheet(VIDEO_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'clip.mp4' })
    const video = await within(dialog).findByLabelText('预览 clip.mp4')
    expect(video.tagName).toBe('VIDEO')
    expect((video as HTMLVideoElement).src).toMatch(/^blob:mock-/)
  })

  it('pdf：iframe title=预览 文件名 + blob src', async () => {
    renderSheet(PDF_ROW)
    await screen.findByRole('dialog', { name: 'doc.pdf' })
    const frame = await screen.findByTitle('预览 doc.pdf')
    expect(frame.tagName).toBe('IFRAME')
    expect((frame as HTMLIFrameElement).src).toMatch(/^blob:mock-/)
  })

  it('text：fetchTextPreview(512*1024) → CodePanel 正文；未截断不出徽标', async () => {
    renderSheet(TEXT_ROW)
    await screen.findByRole('dialog', { name: 'notes.md' })
    await waitFor(() =>
      expect(fetchTextPreview).toHaveBeenCalledWith({ id: 5, original_name: 'notes.md' }, 512 * 1024),
    )
    expect(await screen.findByText('正文内容')).toBeInTheDocument()
    expect(screen.queryByText('已截断')).toBeNull()
    expect(fetchFileContent).not.toHaveBeenCalled()
  })

  it('text 截断：「已截断」徽标 + 旧文案（adbcfba:630「文本较长，仅显示前…」额度随 512 KiB）', async () => {
    fetchTextPreviewMock.mockImplementation(() =>
      Promise.resolve({ blob: new Blob(['前半'], { type: 'text/plain' }), truncated: true }),
    )
    renderSheet(TEXT_ROW)
    await screen.findByRole('dialog', { name: 'notes.md' })
    expect(await screen.findByText('已截断')).toBeInTheDocument()
    expect(screen.getByText('文本较长，仅显示前 512 KiB。')).toBeInTheDocument()
  })

  it('download-only：不发内容请求，Mascot Empty + 直接下载动作→downloadFile', async () => {
    renderSheet(BIN_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'archive.zip' })
    expect(await within(dialog).findByTestId('empty')).toBeInTheDocument()
    expect(fetchFileContent).not.toHaveBeenCalled()
    expect(fetchTextPreview).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: '直接下载' }))
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith({ id: 6, original_name: 'archive.zip' }),
    )
  })

  it('错误：fetch 拒绝 → role=alert 显兜底中文（mutationErrorMessage 通路）', async () => {
    fetchFileContentMock.mockRejectedValue(new Error('boom'))
    renderSheet(IMG_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('操作失败，请稍后重试。')
  })
})

describe('PreviewSheet：blob URL 生命周期与竞态', () => {
  it('row 置 null（关闭）：revokeObjectURL 携当前 URL，img 消失', async () => {
    const { rerender } = renderSheet(IMG_ROW)
    const img = (await screen.findByRole('img')) as HTMLImageElement
    const created = img.src // blob:mock-1
    rerender(
      <>
        <PreviewSheet row={null} onClose={onClose} onAsk={onAsk} />
        <Toaster />
      </>,
    )
    expect(revokeSpy).toHaveBeenCalledWith(created)
    // Radix Presence 退场有卸载时序，异步断言消失
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull())
  })

  it('卸载同样 revoke', async () => {
    const view = renderSheet(IMG_ROW)
    const img = (await screen.findByRole('img')) as HTMLImageElement
    const created = img.src
    view.unmount()
    expect(revokeSpy).toHaveBeenCalledWith(created)
  })

  it('快速切换 row：迟到的旧请求响应被丢弃，新帧不覆盖，且为迟blob建即 revoke（无泄漏）', async () => {
    let resolveLate: ((b: Blob) => void) | null = null
    fetchFileContentMock.mockImplementation((item: FileItem) =>
      item.id === IMG_ROW.id
        ? new Promise<Blob>((res) => {
            resolveLate = res
          })
        : Promise.resolve(new Blob(['late'], { type: 'image/png' })),
    )
    const { rerender } = renderSheet(IMG_ROW) // A：in-flight
    rerender(
      <>
        <PreviewSheet row={IMG_ROW_B} onClose={onClose} onAsk={onAsk} />
        <Toaster />
      </>,
    ) // B：先落定
    const img = (await screen.findByRole('img')) as HTMLImageElement
    expect(img.src).toBe('blob:mock-1') // 当前帧=B
    resolveLate!(new Blob(['stale'], { type: 'image/png' })) // A 迟到
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith('blob:mock-2')) // 迟到的 A blob 建 URL 即回收
    expect((screen.getByRole('img') as HTMLImageElement).src).toBe('blob:mock-1') // 画面未被陈旧响应污染
    expect(screen.getByRole('dialog', { name: 'photo2.png' })).toBeInTheDocument()
  })
})

describe('PreviewSheet：头部操作（评审 minor ⑮）', () => {
  it('下载 → downloadFile 单发 + 旧 toast「下载已开始。」', async () => {
    renderSheet(IMG_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    await userEvent.click(within(dialog).getByRole('button', { name: '下载' }))
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith({ id: 1, original_name: 'photo.png' }),
    )
    expect(await screen.findByText('下载已开始。')).toBeInTheDocument()
  })

  it('下载失败：mutationErrorMessage toast.error，中文透传', async () => {
    downloadFileMock.mockRejectedValue(new Error('boom'))
    renderSheet(IMG_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    await userEvent.click(within(dialog).getByRole('button', { name: '下载' }))
    expect(await screen.findByText('操作失败，请稍后重试。')).toBeInTheDocument()
  })

  it('问 AI：plain disabled + aria-disabled + title 说明 +（即将开放）文字提示槽；onAsk 不触发', async () => {
    renderSheet(TEXT_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'notes.md' })
    const ask = within(dialog).getByRole('button', { name: '问 AI（即将开放）' })
    expect(ask).toBeDisabled()
    expect(ask).toHaveAttribute('aria-disabled', 'true')
    expect(ask).toHaveAttribute('title', 'AI 问答即将开放，敬请期待')
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('关闭按钮 → onClose', async () => {
    renderSheet(IMG_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc：Radix DismissableLayer → onOpenChange(false) → onClose', async () => {
    renderSheet(IMG_ROW)
    const dialog = await screen.findByRole('dialog', { name: 'photo.png' })
    // 键盘 Esc 关闭走 Radix DismissableLayer（actions-flow 菜单用例同法）
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('⑭ 键盘入口：FilesTable 文件名 focus + Enter → onPreview', () => {
  it('聚焦文件名按钮按 Enter 触发预览（与文件夹行名按钮语义对称）', async () => {
    const onPreview = vi.fn()
    render(<FilesTable rows={[IMG_ROW]} onPreview={onPreview} />)
    const nameButton = screen.getByRole('button', { name: 'photo.png' })
    nameButton.focus()
    await userEvent.keyboard('{Enter}')
    expect(onPreview).toHaveBeenCalledWith(IMG_ROW)
  })

  it('双击行仍走预览缝（Task 7 行为不回归）', async () => {
    const onPreview = vi.fn()
    render(<FilesTable rows={[IMG_ROW]} onPreview={onPreview} />)
    await userEvent.dblClick(screen.getByTestId('row-file:1'))
    expect(onPreview).toHaveBeenCalledWith(IMG_ROW)
  })
})
