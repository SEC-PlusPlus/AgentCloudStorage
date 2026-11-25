// Task A7 访客下载页 /d/:token 组件测试（渲染接线复用 unauthorized-wiring 的 routeObjects+AppProviders+
// URL 路由 fetch 桩范式；表单交互复用 login-flow 的 userEvent + act 包裹提交范式）。
// 覆盖 spec §3 v2 状态码矩阵在页面上的呈现：meta 200(开放/需密码)/404/410(reason 三文案)、
// verify 200→下载 href 带 ?access=share_token、401→「密码错误。」、429→限流文案；
// 并断言公开链路（meta/verify）任何情况下都不携带用户登录 JWT（含「已登录访客输错密码不被登出」）。
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '@/providers/AppProviders'
import { routeObjects } from '@/routes'
import { authActions, useAuth } from '@/stores/auth'

const SHARE_TOKEN = 'T3stTok3n-abcDEF'
const META_PATH = `/api/v1/public/shares/${SHARE_TOKEN}`

interface MetaPayload {
  display_name: string
  size: number
  content_type: string
  needs_password: boolean
  expires_at: string | null
}

function openShareMeta(overrides: Partial<MetaPayload> = {}): MetaPayload {
  return {
    display_name: '季度报告.pdf',
    size: 1536, // formatBytes → '1.5 KB'
    content_type: 'application/pdf',
    needs_password: false,
    expires_at: null,
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

interface FetchCall {
  url: string
  headers?: Record<string, string>
  body?: BodyInit | null
}

let metaResult: { status: number; body: unknown }
let verifyResult: { status: number; body: unknown }
let fetchCalls: FetchCall[]

beforeEach(() => {
  authActions.clear()
  fetchCalls = []
  metaResult = { status: 200, body: openShareMeta() }
  verifyResult = { status: 401, body: { error: 'invalid_password' } }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetchCalls.push({ url, headers: init?.headers as Record<string, string> | undefined, body: init?.body })
      if (url === `${META_PATH}/verify`) return jsonResponse(verifyResult.status, verifyResult.body)
      if (url === META_PATH) return jsonResponse(metaResult.status, metaResult.body)
      throw new Error(`unexpected fetch: ${url}`) // 访客页不应触达其它端点（顶层路由无 AppLayout 用量拉取）
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  authActions.clear()
})

/** 经完整路由表渲染：顺带证明 guard meta public 使 /d/:token 在未登录态可达（A7 交付项 3/4 的集成证据）。 */
async function renderSharePage({ authed = false } = {}) {
  if (authed) {
    authActions.setSession('tok', new Date(Date.now() + 3_600_000).toISOString(), {
      id: 1,
      username: 'tester',
      email: 'tester@example.com',
      created_at: '2026-01-01T00:00:00Z',
    })
  }
  const router = createMemoryRouter(routeObjects, { initialEntries: [`/d/${SHARE_TOKEN}`] })
  render(<AppProviders router={router} />)
  await screen.findByTestId('share-route')
  return router
}

/** 填密码并提交（act 包裹：verify promise 续体的状态更新需在 act 内 flush，React 19 纪律同 login-flow）。 */
async function submitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('访问密码'), 'hunter2')
  await act(async () => {
    await user.click(screen.getByRole('button', { name: '验证' }))
  })
}

function expectNoUserTokenOnPublicCalls(): void {
  // 公开链路红线：meta 与 verify 的任何请求头里都不得出现用户 Authorization。
  for (const call of fetchCalls) {
    expect(call.headers?.Authorization).toBeUndefined()
  }
}

describe('ShareRoute：无密码开放链接', () => {
  it('未登录可达：展示文件名/大小/类型，下载 <a download> 的 href 不带 access', async () => {
    await renderSharePage()

    await screen.findByText('季度报告.pdf')
    expect(screen.getByText('1.5 KB')).toBeTruthy()
    expect(screen.getByText('application/pdf')).toBeTruthy()

    const anchor = await screen.findByRole('link', { name: '下载文件' })
    expect(anchor.getAttribute('href')).toBe(`${META_PATH}/download`)
    expect(anchor.hasAttribute('download')).toBe(true)
    expectNoUserTokenOnPublicCalls()
  })

  it('expires_at 非空时显示有效期行', async () => {
    metaResult = { status: 200, body: openShareMeta({ expires_at: '2026-12-31T08:00:00Z' }) }
    await renderSharePage()
    await screen.findByText(/2026-12-31 前有效/)
  })
})

describe('ShareRoute：meta 异常呈现（spec §3 矩阵）', () => {
  it('404 not_found → 「链接不存在」', async () => {
    metaResult = { status: 404, body: { error: 'not_found' } }
    await renderSharePage()
    await screen.findByText('链接不存在')
  })

  it.each([
    ['revoked', '链接已被撤销'],
    ['expired', '链接已过期'],
    ['file_unavailable', '文件暂不可用'],
  ] as const)('410 reason=%s → 「%s」', async (reason, copy) => {
    metaResult = { status: 410, body: { error: 'share_unavailable', reason } }
    await renderSharePage()
    await screen.findByText(copy)
  })

  it('410 未知 reason → 兜底「链接已失效」', async () => {
    metaResult = { status: 410, body: { error: 'share_unavailable', reason: 'unknown_future_reason' } }
    await renderSharePage()
    await screen.findByText('链接已失效')
  })
})

describe('ShareRoute：密码链接生命周期', () => {
  it('needs_password → 表单 → verify 200 → 下载 href 带 ?access=<share_token>（已登录会话也不带用户 JWT）', async () => {
    metaResult = { status: 200, body: openShareMeta({ needs_password: true }) }
    verifyResult = { status: 200, body: { share_token: 'share.jwt.value' } }
    const user = userEvent.setup()
    await renderSharePage({ authed: true })

    await submitPassword(user)

    const anchor = await screen.findByRole('link', { name: '下载文件' })
    expect(anchor.getAttribute('href')).toBe(`${META_PATH}/download?access=share.jwt.value`)
    expectNoUserTokenOnPublicCalls()
    const verifyCall = fetchCalls.find((call) => call.url === `${META_PATH}/verify`)
    expect(verifyCall).toBeTruthy()
    expect(JSON.parse(String(verifyCall?.body))).toEqual({ password: 'hunter2' })
  })

  it('verify 401 → 内联「密码错误。」；不触发登出：会话保留、停在 /d/:token', async () => {
    metaResult = { status: 200, body: openShareMeta({ needs_password: true }) }
    verifyResult = { status: 401, body: { error: 'invalid_password' } }
    const user = userEvent.setup()
    const router = await renderSharePage({ authed: true })

    await submitPassword(user)

    // Field error 槽自带 role=alert：内联呈现（非 toast-only）。
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('密码错误。')
    expect(screen.queryByRole('link', { name: '下载文件' })).toBeNull()
    // 访客侧 401 不得触发 user-token 登出链路：会话保留、仍停在访客页。
    expect(router.state.location.pathname).toBe(`/d/${SHARE_TOKEN}`)
    expect(useAuth.getState().token).toBe('tok')
  })

  it('verify 429 → 「尝试次数过多，请稍后再试。」', async () => {
    metaResult = { status: 200, body: openShareMeta({ needs_password: true }) }
    verifyResult = { status: 429, body: { error: 'too many share verify attempts' } }
    const user = userEvent.setup()
    await renderSharePage()

    await submitPassword(user)

    await screen.findByText('尝试次数过多，请稍后再试。')
  })

  it('密码正确后表单消失，重复访问同页不重新出现（share_token 存组件态）', async () => {
    metaResult = { status: 200, body: openShareMeta({ needs_password: true }) }
    verifyResult = { status: 200, body: { share_token: 'share.jwt.value' } }
    const user = userEvent.setup()
    await renderSharePage()

    await submitPassword(user)
    await waitFor(() => expect(screen.queryByLabelText('访问密码')).toBeNull())
    expect(screen.getByRole('link', { name: '下载文件' }).getAttribute('href')).toContain('?access=share.jwt.value')
  })
})
