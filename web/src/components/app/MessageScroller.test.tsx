// self-build 测试：shouldStickToBottom 纯数学 + 容器行为（jsdom 无布局——高度用 defineProperty 桩，
// 滚动事件 fireEvent.scroll 驱动；断言 stick 判定与「跳到最新」浮钮出现/归位）。
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageScroller, shouldStickToBottom } from './MessageScroller'

describe('shouldStickToBottom——scrollHeight - scrollTop - clientHeight <= threshold', () => {
  it('贴底（距离 0）与恰等阈值 → true；阈值 +1 → false', () => {
    expect(shouldStickToBottom(900, 1000, 100, 80)).toBe(true) // 距底 0
    expect(shouldStickToBottom(820, 1000, 100, 80)).toBe(true) // 距底 80=阈值，等号放行
    expect(shouldStickToBottom(819, 1000, 100, 80)).toBe(false) // 距底 81
  })

  it('内容不足一屏（scrollHeight<=clientHeight）恒 true——空/短对话不因 jsdom 式 0 高度脱钩', () => {
    expect(shouldStickToBottom(0, 0, 0, 80)).toBe(true)
    expect(shouldStickToBottom(0, 50, 100, 80)).toBe(true)
  })

  it('新内容撑高后距底超过阈值 → false（滚动条被历史顶起）', () => {
    expect(shouldStickToBottom(400, 1000, 100, 80)).toBe(false)
  })
})

describe('MessageScroller 行为', () => {
  afterEach(cleanup)

  function stub(el: HTMLElement, props: Record<string, number>) {
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(el, key, { configurable: true, writable: true, value })
    }
  }

  it('aria-live=polite（新 assistant 轮由列表区播报）', () => {
    render(
      <MessageScroller turnCount={1}>
        <p>hi</p>
      </MessageScroller>,
    )
    const log = screen.getByRole('log', { name: '问答对话' })
    expect(log).toHaveAttribute('aria-live', 'polite')
  })

  it('scroll 事件距底 >阈值 → 浮出「跳到最新」；点击后滚回底部并收起', () => {
    render(
      <MessageScroller turnCount={2}>
        <p>老对话</p>
      </MessageScroller>,
    )
    const log = screen.getByRole('log', { name: '问答对话' })
    stub(log, { scrollTop: 400, scrollHeight: 1000, clientHeight: 100 })
    fireEvent.scroll(log)
    const jump = screen.getByRole('button', { name: '跳到最新' })
    log.scrollTop = 400 // jsdom 写入即存值，click 处理读 scrollHeight=1000
    fireEvent.click(jump)
    expect(log.scrollTop).toBe(1000)
    fireEvent.scroll(log)
    expect(screen.queryByRole('button', { name: '跳到最新' })).toBeNull()
  })

  it('turnCount 变化且原本贴底 → 自动滚到最新；已上滚则不抢滚动', () => {
    const { rerender } = render(
      <MessageScroller turnCount={1}>
        <p>A</p>
      </MessageScroller>,
    )
    const log = screen.getByRole('log', { name: '问答对话' })
    stub(log, { scrollTop: 0, scrollHeight: 500, clientHeight: 100 })
    rerender(
      <MessageScroller turnCount={2}>
        <p>A</p>
        <p>B</p>
      </MessageScroller>,
    )
    expect(log.scrollTop).toBe(500) // 初始贴底 → 新轮自动跟进
    // 上滚越过阈值 → 新轮不抢位
    log.scrollTop = 100
    fireEvent.scroll(log)
    rerender(
      <MessageScroller turnCount={3}>
        <p>A</p>
        <p>B</p>
        <p>C</p>
      </MessageScroller>,
    )
    expect(log.scrollTop).toBe(100)
    expect(screen.getByRole('button', { name: '跳到最新' })).toBeInTheDocument()
  })
})
