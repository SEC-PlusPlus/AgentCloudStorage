import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@/lib/brand'

describe('skeleton smoke', () => {
  it('vitest + jsdom toolchain runs', () => {
    expect(1 + 1).toBe(2)
  })

  it('jsdom environment is active', () => {
    // T13 carry #3（Task 1 minor ②）：URL 断言不再赌 vitest 默认值——jsdom url 已固化于
    // vite.config test.environmentOptions（改默认也不漂）。能力断言意图不变。
    expect(document).toBeDefined()
    expect(window.location.href).toBe('http://localhost:3000/')
  })

  it('@/ path alias resolves (tsconfig paths + vite alias)', () => {
    // T13 carry #5（Task 4 minor ③）：不再借 Task 1 骨架孤儿 App.tsx（main 早已不引用，已删）——改指真实模块。
    expect(typeof APP_NAME).toBe('string')
  })
})
