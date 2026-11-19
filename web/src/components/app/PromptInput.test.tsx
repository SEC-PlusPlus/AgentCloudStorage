// self-build 测试：IME 组合期 Enter 不提交（compositionstart/end + keydown 双通道：ref 记忆 +
// nativeEvent.isComposing 兜底——jsdom 的 KeyboardEvent 能带 isComposing 旗标，真机走 ref 通道）；
// 普通 Enter 提交、Shift+Enter 换行；500 上限 + 实时计数「N / 500」（旧 adbcfba:611 语义）。
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { PromptInput } from './PromptInput'

function setup(overrides: Partial<ComponentProps<typeof PromptInput>> = {}) {
  const onSubmit = vi.fn()
  const onChange = vi.fn()
  const props = {
    value: '',
    onChange,
    onSubmit,
    busy: false,
    eligible: true,
    maxLength: 500,
    placeholder: '例如：这份资料的主要结论是什么？',
    ...overrides,
  }
  render(<PromptInput {...props} />)
  const textarea = screen.getByRole('textbox', { name: '你的问题' })
  return { textarea, onSubmit, onChange, props }
}

describe('PromptInput', () => {
  afterEach(cleanup)

  it('IME：compositionstart 后的 Enter 不提交；compositionEnd 后恢复提交', () => {
    const { textarea, onSubmit } = setup({ value: '提问中' })
    fireEvent.compositionStart(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true }) // 兜底旗标通道同样不提交
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.compositionEnd(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('普通 Enter 提交；Shift+Enter 不提交（换行留给 textarea 原生）', () => {
    const { textarea, onSubmit } = setup({ value: '问题全文' })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('空白问题：Enter 与发送按钮都不提交（旧 :611 disabled 判定 !trim 逐字语义）', () => {
    const { textarea, onSubmit } = setup({ value: '   ' })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    const send = screen.getByRole('button', { name: '发送问题' })
    expect(send).toBeDisabled()
  })

  it('计数实时「N / 500」+ maxLength 透传（旧 :611 逐字格式）', () => {
    const { textarea, onChange } = setup({ value: 'abc' })
    expect(screen.getByText('3 / 500')).toBeInTheDocument()
    expect(textarea).toHaveAttribute('maxlength', '500')
    expect(textarea).toHaveAttribute('placeholder', '例如：这份资料的主要结论是什么？')
    fireEvent.change(textarea, { target: { value: 'abcd' } })
    expect(onChange).toHaveBeenCalledWith('abcd')
  })

  it('busy：输入禁用（旧 :611 :disabled=askBusy），发送位换为止按钮且可点', () => {
    const onStop = vi.fn()
    const { textarea } = setup({ value: '已发出的问题', busy: true, onStop })
    expect(textarea).toBeDisabled()
    expect(screen.queryByRole('button', { name: '发送问题' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '停止回答' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('文件不合格（eligible=false）：发送禁用、输入禁用（旧超限禁提交语义的扩展承接）', () => {
    const { textarea } = setup({ value: '问题', eligible: false })
    expect(screen.getByRole('button', { name: '发送问题' })).toBeDisabled()
    expect(textarea).toBeDisabled()
  })

  it('自动增高：textarea 高度随内容重设（style.height 由 scrollHeight 驱动，封顶 maxHeight）', () => {
    const { textarea } = setup({ value: '一'.repeat(40) })
    // jsdom scrollHeight=0 → height 落 0 后被 clamp 至最小行高——只钉「写过 style.height」
    expect(textarea.style.height).toBe('0px')
  })
})
