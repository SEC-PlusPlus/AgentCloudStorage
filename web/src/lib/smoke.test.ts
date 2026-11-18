import { describe, expect, it } from 'vitest'
import App from '@/App'

describe('skeleton smoke', () => {
  it('vitest + jsdom toolchain runs', () => {
    expect(1 + 1).toBe(2)
  })

  it('jsdom environment is active', () => {
    expect(document).toBeDefined()
    expect(window.location.href).toBe('http://localhost:3000/')
  })

  it('@/ path alias resolves (tsconfig paths + vite alias)', () => {
    expect(typeof App).toBe('function')
  })
})
