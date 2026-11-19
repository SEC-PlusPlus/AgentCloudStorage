// 401 接线单测（Task 4 Step 3 / Review Focus #1 收口；Task 7 控制端附带修复：桩改 URL+开关感知）。
// 背景：Task 7 前 /files 是占位 div，TopBar ['usage'] 是挂载期唯一 fetch，故旧桩用「首个调用 200、
// 其余 401」的位置序承接自动请求——真实文件列表挂载后 files/folders/usage 并发且顺序不定，位置序失效。
// 现桩按 URL 路由响应：usage 由 failUsage401 开关显式控制（默认 200），files/folders 恒 200 空列表，
// 401 只在用例主动开开关后触发，保持「手动触发才走 401 分支」的原有语义。全部 401 断言原样保留。
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

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

/** 401 触发开关：默认关（usage 200）；用例在需要时显式置 true——不再依赖调用顺序。 */
let failUsage401 = false

describe('401 接线：unauthorizedHandler → 清会话 + 跳 /login + toast（Review Focus #1）', () => {
  beforeEach(() => {
    loginSession()
    failUsage401 = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/v1/storage/usage')) {
          return failUsage401
            ? jsonResponse(401, { error: 'token expired' })
            : jsonResponse(200, { used_bytes: 1024, quota_bytes: 4096 })
        }
        if (url.startsWith('/api/v1/files') || url.startsWith('/api/v1/folders')) {
          // Task 7 起 /files 真实挂载：files 分页列表 / folders 子目录列表恒 200 空数据。
          const body = url.startsWith('/api/v1/folders')
            ? { items: [] }
            : { items: [], pagination: { page: 1, page_size: 20, total: 0 } }
          return jsonResponse(200, body)
        }
        throw new Error(`unexpected fetch: ${url}`)
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

    // 等到 AppLayout（挂载效应注册 handler）与 /files 真实列表渲染完成
    await screen.findByTestId('files-route')

    failUsage401 = true
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
    failUsage401 = true
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
