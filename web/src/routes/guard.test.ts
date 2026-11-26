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

  // Task A7（访客下载页 /d/:token）：public 一律放行 + 既有 gating 语义不动。
  it('public + 未登录 → true（访客免登录可达）', () => {
    expect(canAccess({ public: true }, false)).toBe(true)
  })

  it('public + 已登录 → true（登录态不干扰访客页）', () => {
    expect(canAccess({ public: true }, true)).toBe(true)
  })

  it('public 与非 public meta 并存时 public 先短路（配置错误的确定性）', () => {
    expect(canAccess({ public: true, requiresAuth: true }, false)).toBe(true)
    expect(canAccess({ public: true, guestOnly: true }, true)).toBe(true)
  })

  it('非 public：既有 gating 不变（无 meta.public 键的旧调用零影响）', () => {
    expect(canAccess({ requiresAuth: true, public: false }, false)).toBe('/login')
    expect(canAccess({ guestOnly: true, public: false }, true)).toBe('/')
  })
})
