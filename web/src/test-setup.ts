import '@testing-library/jest-dom/vitest'

// jsdom 29 未实现 window.matchMedia，而 sonner 挂载时需要它（prefers-reduced-motion 检测）。
// 全局补一个恒定 matches:false 的最小实现，等价于「无减弱动效偏好」，不影响断言。
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

// jsdom 29 未实现 IntersectionObserver，vendored BlurFade（登录页 mascot 入场）挂载效应依赖它。
// 最小空实现：回调永不触发（元素保持 opacity:0），不断言动效，仅保证渲染不抛错。
class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return []
  }
}
if (!('IntersectionObserver' in window)) {
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    IntersectionObserverStub
}
