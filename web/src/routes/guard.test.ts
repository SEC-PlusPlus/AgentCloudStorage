import { describe, expect, it } from 'vitest'
import { canAccess } from '@/routes/guard'

describe('canAccess（路由守卫纯函数，对应旧 Vue 版 router.beforeEach）', () => {
  it('requiresAuth + 未登录 → /login', () => {
    expect(canAccess({ requiresAuth: true }, false)).toBe('/login')
  })

  it('requiresAuth + 已登录 → true', () => {
    expect(canAccess({ requiresAuth: true }, true)).toBe(true)
  })

  it('guestOnly + 已登录 → /', () => {
    expect(canAccess({ guestOnly: true }, true)).toBe('/')
  })

  it('guestOnly + 未登录 → true', () => {
    expect(canAccess({ guestOnly: true }, false)).toBe(true)
  })

  it('空 meta：登录与否都放行', () => {
    expect(canAccess({}, false)).toBe(true)
    expect(canAccess({}, true)).toBe(true)
  })

  it('requiresAuth 与 guestOnly 同时出现时 requiresAuth 优先', () => {
    expect(canAccess({ requiresAuth: true, guestOnly: true }, false)).toBe('/login')
    expect(canAccess({ requiresAuth: true, guestOnly: true }, true)).toBe(true)
  })
})
