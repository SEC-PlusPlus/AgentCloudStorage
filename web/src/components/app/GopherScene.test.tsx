// GopherScene 移植锚（T13 carry #22）：静态几何逐坐标搬运的 path 计数 + prefers-reduced-motion 两支。
// rAF 全程打桩（draw 不真跑——jsdom 未实现 getPointAtLength，动画数值正确性归浏览器手测），
// matchMedia 按用例注入 matches 旗标，镜像旧 syncMotion() 的换向语义。
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GopherScene } from './GopherScene'

function mockMatchMedia(matches: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('GopherScene（StorageScene 移植）', () => {
  it('SVG 几何搬运完整：4 条 path（地线/飞行线/包内线条/货架线条）+ 装饰图形 + 旧 caption 逐字', () => {
    mockMatchMedia(true)
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)
    const { container } = render(<GopherScene />)
    expect(container.querySelectorAll('svg path')).toHaveLength(4)
    expect(container.querySelectorAll('svg rect')).toHaveLength(6)
    expect(container.querySelectorAll('svg circle')).toHaveLength(7)
    expect(screen.getByText('文件从浏览器出发，安稳落在你的存储空间。')).toBeInTheDocument()
    // showCaption=false 场景（DropOverlay 角落用）
    cleanup()
    render(<GopherScene showCaption={false} />)
    expect(screen.queryByText('文件从浏览器出发，安稳落在你的存储空间。')).toBeNull()
    rafSpy.mockRestore()
  })

  it('prefers-reduced-motion=reduce：静态帧 (350,154)/不透明 1，绝不起 rAF（旧 syncMotion 降级语义）', () => {
    mockMatchMedia(true)
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)
    render(<GopherScene />)
    expect(rafSpy).not.toHaveBeenCalled()
    const packet = screen.getByTestId('gopher-packet')
    expect(packet).toHaveAttribute('transform', 'translate(350 154) rotate(0)')
    expect(packet).toHaveAttribute('opacity', '1')
  })

  it('无减弱偏好：起飞行 rAF 循环（一帧打桩，不真取路径点）', () => {
    mockMatchMedia(false)
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)
    render(<GopherScene />)
    expect(rafSpy).toHaveBeenCalledTimes(1)
    // 初帧静态可见性=旧初值（opacity 0，750ms 起飞延迟前不可见）
    expect(screen.getByTestId('gopher-packet')).toHaveAttribute('transform', 'translate(270 175) rotate(0)')
  })
})
