import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '@/api/auth'

const TOKEN_KEY = 'acs.access-token'
const EXPIRES_KEY = 'acs.expires-at'
const USER_KEY = 'acs.user'

const user: UserProfile = { id: 7, username: 'gopher', email: 'gopher@acs.dev', created_at: '2026-01-01T00:00:00Z' }
const futureIso = () => new Date(Date.now() + 3_600_000).toISOString()
const pastIso = () => new Date(Date.now() - 3_600_000).toISOString()

async function freshStoreModule() {
  vi.resetModules()
  return import('@/stores/auth')
}

beforeEach(() => {
  sessionStorage.clear()
  vi.resetModules()
})

describe('auth store（zustand + 旧版 sessionStorage 三键兼容）', () => {
  it('setSession 写入三键并更新 state', async () => {
    const { authActions, useAuth } = await freshStoreModule()
    const expiresAt = futureIso()
    authActions.setSession('tok-1', expiresAt, user)
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok-1')
    expect(sessionStorage.getItem(EXPIRES_KEY)).toBe(expiresAt)
    expect(JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null')).toEqual(user)
    expect(useAuth.getState()).toEqual({ token: 'tok-1', expiresAt, user })
  })

  it('isAuthenticated：未登录 false / 过期 false / 有效 true', async () => {
    const { authActions, isAuthenticated, useAuth } = await freshStoreModule()
    expect(isAuthenticated(useAuth.getState())).toBe(false)
    authActions.setSession('tok-2', pastIso(), user)
    expect(isAuthenticated(useAuth.getState())).toBe(false)
    authActions.setSession('tok-2', futureIso(), user)
    expect(isAuthenticated(useAuth.getState())).toBe(true)
  })

  it('clear 清空 state 与三键', async () => {
    const { authActions } = await freshStoreModule()
    authActions.setSession('tok-3', futureIso(), user)
    authActions.clear()
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(sessionStorage.getItem(EXPIRES_KEY)).toBeNull()
    expect(sessionStorage.getItem(USER_KEY)).toBeNull()
  })

  it('restore：有效会话在模块加载时水合，getToken 非 hook 可读', async () => {
    const expiresAt = futureIso()
    sessionStorage.setItem(TOKEN_KEY, 'tok-4')
    sessionStorage.setItem(EXPIRES_KEY, expiresAt)
    sessionStorage.setItem(USER_KEY, JSON.stringify(user))
    const { getToken, useAuth } = await freshStoreModule()
    expect(useAuth.getState()).toEqual({ token: 'tok-4', expiresAt, user })
    expect(getToken()).toBe('tok-4')
  })

  it('restore：过期会话自动清除三键并回落空 state', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'tok-5')
    sessionStorage.setItem(EXPIRES_KEY, pastIso())
    sessionStorage.setItem(USER_KEY, JSON.stringify(user))
    const { getToken, isAuthenticated, useAuth } = await freshStoreModule()
    expect(useAuth.getState()).toEqual({ token: '', expiresAt: '', user: null })
    expect(getToken()).toBe('')
    expect(isAuthenticated(useAuth.getState())).toBe(false)
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(sessionStorage.getItem(EXPIRES_KEY)).toBeNull()
    expect(sessionStorage.getItem(USER_KEY)).toBeNull()
  })

  it('restore：user 键损坏时容错清除（同旧版 try/catch）', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'tok-6')
    sessionStorage.setItem(EXPIRES_KEY, futureIso())
    sessionStorage.setItem(USER_KEY, '{not json')
    const { useAuth } = await freshStoreModule()
    expect(useAuth.getState()).toEqual({ token: '', expiresAt: '', user: null })
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})
