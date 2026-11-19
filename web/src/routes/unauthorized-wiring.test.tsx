// 401 接线单测（Task 4 Step 3 / Review Focus #1 收口）：
// jsdom 渲染整棵 Provider 树 → 在 AppLayout 内触发真实 api（getStorageUsage，fetch 桩 401）
// → 断言会话清空、路由到 /login、sonner toast「登录已过期」DOM 存在。
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStorageUsage } from '@/api/storage'
import { AppProviders } from '@/providers/AppProviders'
import { routeObjects } from '@/routes'
import { authActions, useAuth } from '@/stores/auth'

const TOKEN_KEY = 'acs.access-token'
const EXPIRES_KEY = 'acs.expires-at'
const USER_KEY = 'acs.user'

function loginSession(): void {
  authActions.setSession('tok', new Date(Date.now() + 3_600_000).toISOString(), {
    id: 1,
    username: 'tester',
    email: 'tester@example.com',
    created_at: '2026-01-01T00:00:00Z',
  })
}

describe('401 接线：unauthorizedHandler → 清会话 + 跳 /login + toast（Review Focus #1）', () => {
  beforeEach(() => {
    loginSession()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'token expired' }),
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    authActions.clear()
  })

  it('AppLayout 挂载后触发 401：store 清空、sessionStorage 移除、路径 /login、toast DOM 存在', async () => {
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/files'] })
    render(<AppProviders router={router} />)

    // 等到 AppLayout（挂载效应注册 handler）与 /files 占位渲染完成
    await screen.findByTestId('files-route')

    await act(async () => {
      await getStorageUsage().catch(() => undefined) // request 401 分支：notifyUnauthorized() + ApiError 上抛
    })

    // 1. 会话清空（store + sessionStorage 三键）
    expect(useAuth.getState().token).toBe('')
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(sessionStorage.getItem(EXPIRES_KEY)).toBeNull()
    expect(sessionStorage.getItem(USER_KEY)).toBeNull()

    // 2. 路由跳到 /login（router 状态 + 登录页占位 DOM 双重证据）
    expect(router.state.location.pathname).toBe('/login')
    await screen.findByTestId('login-route')

    // 3. sonner toast「登录已过期」渲染进 DOM
    await screen.findByText('登录已过期')
  })

  it('卸载 AppProviders 后反注册：再触发 401 不抛错、不改路由', async () => {
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/files'] })
    const view = render(<AppProviders router={router} />)
    await screen.findByTestId('files-route')
    view.unmount()

    // 处理器已置 null：request 的 401 分支仍上抛 ApiError，但不应触发任何跳转/清会话
    loginSession()
    await act(async () => {
      await getStorageUsage().catch(() => undefined)
    })
    expect(useAuth.getState().token).toBe('tok')
    expect(router.state.location.pathname).toBe('/files')
    expect(screen.queryByText('登录已过期')).toBeNull()
  })

  it('未登录访问 /files 被守卫弹回 /login；已登录访问 /login 弹回 /', async () => {
    authActions.clear()
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/files'] })
    render(<AppProviders router={router} />)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

    loginSession()
    const router2 = createMemoryRouter(routeObjects, { initialEntries: ['/login'] })
    render(<AppProviders router={router2} />)
    // '/login' 弹回 '/'，'/' index 再重定向 /files：同一条 redirect 链，中间态 '/' 不可观测，只断言终点
    await waitFor(() => expect(router2.state.location.pathname).toBe('/files'))
    await screen.findByTestId('files-route')
  })
})
