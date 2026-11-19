// Task 12 全流程锚：faked askFile——pending→thinking→answer、中途关闭 abort 断言（signal.aborted）、
// 500 → failed 气泡（旧文案逐字）+ 重试重发同问且用户气泡不重复、空回答兜底文案、旧占位符/计数/
// 「发送问题」按钮语义承接。abort-on-close 为 plan-sanctioned 新增（旧版仅关闭=作废 generation）。
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { askFile } from '@/api/knowledge'
import { QaSheet } from './QaSheet'
import type { FileRow } from '@/features/files/useFileRows'

vi.mock('@/api/knowledge', () => ({ askFile: vi.fn() }))

const askFileMock = vi.mocked(askFile)

const ROW: FileRow = {
  kind: 'file', id: 7, name: 'notes.md', sizeBytes: 2048, sizeText: '2 KiB',
  dateText: '2026-01-01', contentType: 'text/markdown',
}

let signals: AbortSignal[] = []

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  const close = () => {
    onClose()
    setOpen(false) // 复刻 FilesPage：onClose → qaRow=null → 卸载（=abort 通道）
  }
  return open ? <QaSheet row={ROW} open onClose={close} /> : null
}

async function ask(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '你的问题' }), { target: { value: question } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '你的问题' }), { key: 'Enter' })
}

beforeEach(() => {
  signals = []
  askFileMock.mockReset()
  askFileMock.mockImplementation((...args) => {
    signals.push(args[2] as AbortSignal)
    return Promise.resolve({ answer: '主要结论是 X。' })
  })
})

afterEach(() => {
  cleanup()
})

describe('QaSheet 对话流', () => {
  it('打开即显旧问答面板文案：kicker/标题/文件名/intro/占位符逐字', () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog', { name: '向文件提问' })
    expect(within(dialog).getByText('资料问答')).toBeInTheDocument()
    expect(within(dialog).getByText(ROW.name)).toBeInTheDocument()
    expect(
      within(dialog).getByText('只根据这份文件回答。支持 UTF-8 的 TXT / Markdown，回答中的 [数字] 对应文件段落。'),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：这份资料的主要结论是什么？')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '关闭问答' })).toBeInTheDocument()
  })

  it('pending → thinking（旧状态文案）→ answer 轮上屏；askFile 收 (id, question, signal)；输入清空', async () => {
    let resolve!: (v: { answer: string }) => void
    askFileMock.mockImplementationOnce((...args) => {
      signals.push(args[2] as AbortSignal)
      return new Promise((r) => { resolve = r })
    })
    render(<Harness />)
    await ask('这份资料的主要结论是什么？')

    expect(screen.getByText('这份资料的主要结论是什么？')).toBeInTheDocument() // user 气泡
    // T13 carry #21b：Thinking 不再自带 role=status（嵌 role=log 双报）——占位文案仍在 log 内可见，
    // 状态角色消失（dialog 内查不到 status），播报职责归外层 log。
    expect(
      within(screen.getByRole('log', { name: '问答对话' })).getByText('正在从文件中寻找回答…'),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: '向文件提问' })).queryByRole('status')).toBeNull()
    expect(askFileMock).toHaveBeenCalledTimes(1)
    expect(askFileMock.mock.calls[0]?.[0]).toBe(7)
    expect(askFileMock.mock.calls[0]?.[1]).toBe('这份资料的主要结论是什么？')
    expect(signals[0]?.aborted).toBe(false)

    resolve({ answer: '主要结论是 X。' })
    expect(await screen.findByText('主要结论是 X。')).toBeInTheDocument()
    expect(screen.queryByText('正在从文件中寻找回答…')).toBeNull()
    expect(screen.getByRole('textbox', { name: '你的问题' })).toHaveValue('') // 旧提交后不清空？——新版清空便于连续追问
  })

  it('模型空回答 → 旧兜底文案「模型没有返回回答，请重试。」上屏', async () => {
    askFileMock.mockImplementationOnce((...args) => {
      signals.push(args[2] as AbortSignal)
      return Promise.resolve({ answer: '   ' })
    })
    render(<Harness />)
    await ask('问')
    expect(await screen.findByText('模型没有返回回答，请重试。')).toBeInTheDocument()
  })

  it('关闭 sheet 中断在途问答：onClose 后 signal.aborted=true 且迟到响应不落屏', async () => {
    let resolve!: (v: { answer: string }) => void
    askFileMock.mockImplementationOnce((...args) => {
      signals.push(args[2] as AbortSignal)
      return new Promise((r) => { resolve = r })
    })
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await ask('半途的问题')
    fireEvent.click(screen.getByRole('button', { name: '关闭问答' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(signals[0]?.aborted).toBe(true)
    resolve({ answer: '不该出现的迟到答案' })
    await waitFor(() => expect(screen.queryByText('不该出现的迟到答案')).toBeNull())
  })

  it('停止按钮（新增能力）：中途 abort，不产生 failed 气泡，可再次提交', async () => {
    askFileMock.mockImplementationOnce((...args) => {
      signals.push(args[2] as AbortSignal)
      return new Promise(() => undefined) // 永挂
    })
    render(<Harness />)
    await ask('不想等了')
    fireEvent.click(screen.getByRole('button', { name: '停止回答' }))
    expect(signals[0]?.aborted).toBe(true)
    expect(screen.queryByText('问答失败。请确认文件为较短的 UTF-8 文本，或稍后重试。')).toBeNull()
    // 可再发：输入重新可用
    expect(screen.getByRole('textbox', { name: '你的问题' })).toBeEnabled()
  })

  it('500 → failed 气泡（旧 :365 文案逐字）；重试重发同问且用户气泡不重复', async () => {
    askFileMock
      .mockImplementationOnce((...args) => {
        signals.push(args[2] as AbortSignal)
        return Promise.reject(new ApiError('问答失败。请确认文件为较短的 UTF-8 文本，或稍后重试。', 500))
      })
      .mockImplementationOnce((...args) => {
        signals.push(args[2] as AbortSignal)
        return Promise.resolve({ answer: '重试成功的答案' })
      })
    render(<Harness />)
    await ask('结论呢？')

    const errorCopy = '问答失败。请确认文件为较短的 UTF-8 文本，或稍后重试。'
    expect(await screen.findByRole('alert')).toHaveTextContent(errorCopy)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(askFileMock).toHaveBeenCalledTimes(2))
    expect(askFileMock.mock.calls[1]?.[1]).toBe('结论呢？') // 重发同一问题
    expect(await screen.findByText('重试成功的答案')).toBeInTheDocument()
    expect(screen.queryByText(errorCopy)).toBeNull() // failed 气泡被替换
    expect(screen.getAllByText('结论呢？')).toHaveLength(1) // 用户轮不重复计入
    expect(signals[1]?.aborted).toBe(false)
  })

  it('非 500 ApiError → 中文映射 message 透传进 failed 气泡', async () => {
    askFileMock.mockImplementationOnce((...args) => {
      signals.push(args[2] as AbortSignal)
      return Promise.reject(new ApiError('文件不存在。', 404))
    })
    render(<Harness />)
    await ask('问题')
    expect(await screen.findByRole('alert')).toHaveTextContent('文件不存在。')
  })

  it('scroller a11y：role=log + aria-live=polite；计数「N / 500」在 sheet 内实时', () => {
    render(<Harness />)
    expect(screen.getByRole('log', { name: '问答对话' })).toHaveAttribute('aria-live', 'polite')
    fireEvent.change(screen.getByRole('textbox', { name: '你的问题' }), { target: { value: '你好' } })
    expect(screen.getByText('2 / 500')).toBeInTheDocument()
  })
})
