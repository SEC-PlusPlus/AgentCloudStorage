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
