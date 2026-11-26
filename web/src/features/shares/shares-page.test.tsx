// Task W2 「我的分享」页行为锚（jsdom）：列表三态标签（RULING=design §1.1 只标事实态：已撤销/已过期/
// 未到期，绝无「有效」措辞、零 N+1 探测）+ 链接列中段省略与复制（origin URL；clipboard 拒绝回退选中，
// 与 ShareDialog 同纪律）+ 有效期（formatDate/永久）+ 撤销 204→['shares'] 失效→重取后行内状态更新
// （ListByOwner 含 revoked 行——行更新非消失）+ 空态/加载/错误 + Dock 导航项 + /shares 路由注册。
// fetch 桩按 URL+method 路由（trash-page.test 同纪律）；jsdom origin 钉 http://localhost:3000。
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { Toaster, toast } from 'sonner'
import { Dock } from '@/components/app/Dock'
import { AppProviders } from '@/providers/AppProviders'
import { ThemeProvider } from '@/providers/theme'
import { routeObjects } from '@/routes'
import { authActions } from '@/stores/auth'
import { middleEllipsis, SharesPage } from './SharesPage'

function jsonResponse(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

// spec §A：token 43 字符——URL 全长 67 > 省略阈值，链接列必然中段截断（渲染用例顺带钉视觉截断）。
const LONG_TOKEN = 'Vq7Lb3nZrW2sT0k3nXy8dHa5pEc6mGj4fNu9iOt1kLs'

const SHARE_ACTIVE = {
  token: LONG_TOKEN, canonical_url: `https://secplusplus.xyz/d/${LONG_TOKEN}`, display_name: 'a.txt',
  expires_at: '2027-06-01T12:00:00Z', download_count: 3, revoked: false,
  created_at: '2026-11-20T12:00:00Z', has_password: true,
}
const SHARE_EXPIRED = {
  token: 'tokExp', canonical_url: 'https://secplusplus.xyz/d/tokExp', display_name: 'old.mp4',
  expires_at: '2026-01-01T00:00:00Z', download_count: 7, revoked: false,
  created_at: '2025-12-01T00:00:00Z', has_password: false,
}
const SHARE_REVOKED = {
  token: 'tokRev', canonical_url: 'https://secplusplus.xyz/d/tokRev', display_name: 'gone.zip',
  expires_at: null, download_count: 0, revoked: true,
  created_at: '2026-10-01T00:00:00Z', has_password: false,
}
const SHARE_PERMANENT = {
  token: 'tokPerm', canonical_url: 'https://secplusplus.xyz/d/tokPerm', display_name: 'keep.pdf',
  expires_at: null, download_count: 12, revoked: false,
  created_at: '2026-09-01T00:00:00Z', has_password: false,
}

const DEFAULT_ITEMS = [SHARE_ACTIVE, SHARE_EXPIRED, SHARE_REVOKED, SHARE_PERMANENT]

let listBody: unknown = { items: DEFAULT_ITEMS }
let listStatus = 200
let holdList: Promise<void> | null = null
let revokeRes: { status: number; body?: unknown } = { status: 204 }

interface Sent { url: string; method: string }
let requests: Sent[] = []

function impl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  requests.push({ url, method })
  if (method === 'GET' && url === '/api/v1/shares') {
    return (holdList ?? Promise.resolve()).then(() =>
      listStatus === 200 ? jsonResponse(200, listBody) : jsonResponse(listStatus, { error: 'boom' }),
    )
  }
  if (method === 'GET' && url.startsWith('/api/v1/storage/usage')) {
    return Promise.resolve(jsonResponse(200, { used_bytes: 1024, quota_bytes: 4096 })) // 路由冒烟的 AppLayout/TopBar
  }
  if (method === 'DELETE' && /^\/api\/v1\/shares\//.test(url)) {
    // 模拟服务端事实：204 后 ListByOwner 重取返回同 token 的 revoked=true 行（行更新非消失）。
    if (revokeRes.status === 204) {
      const token = decodeURIComponent(url.replace('/api/v1/shares/', ''))
      const items = (listBody as { items: typeof DEFAULT_ITEMS }).items.map((item) =>
        item.token === token ? { ...item, revoked: true } : item,
      )
      listBody = { items }
    }
    return Promise.resolve(jsonResponse(revokeRes.status, revokeRes.body))
  }
  return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`))
}

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => impl(input, init))

let queryClient: QueryClient
let invalidateSpy: MockInstance<(options?: { queryKey?: unknown }) => Promise<void>>

function LocationProbe() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

function renderPage(entry = '/shares') {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <SharesPage />
        <LocationProbe />
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  )
}

function renderShell(ui: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/files']}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

const sent = (method: string, pattern: RegExp): Sent | undefined =>
  requests.find((r) => r.method === method && pattern.test(r.url))

const invalidatedKeys: () => unknown[] = () =>
  invalidateSpy.mock.calls.map(([opts]) => (opts as { queryKey?: unknown }).queryKey)

beforeEach(() => {
  listBody = { items: DEFAULT_ITEMS }
  listStatus = 200
  holdList = null
  revokeRes = { status: 204 }
  requests = []
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
})

afterEach(() => {
  toast.dismiss()
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  authActions.clear()
})

describe('列表渲染：列集 + 三态标签（RULING：只标事实态，无「有效」措辞）', () => {
  it('表头列集；revoked→已撤销、past expires→已过期、其余→未到期、null→永久', async () => {
    renderPage()
    await screen.findByText('a.txt')
    for (const header of ['名称', '链接', '有效期', '下载次数', '状态', '操作']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    expect(within(screen.getByTestId('share-row-a.txt')).getByText('未到期')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-old.mp4')).getByText('已过期')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-gone.zip')).getByText('已撤销')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-keep.pdf')).getByText('未到期')).toBeInTheDocument()
  })

  it('页头「我的分享」+ N 个分享；有效期 formatDate 与 永久；下载次数原样', async () => {
    renderPage()
    await screen.findByText('a.txt')
    expect(screen.getByRole('heading', { name: '我的分享' })).toBeInTheDocument()
    expect(screen.getByText('4 个分享')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-a.txt')).getByText('2027-06-01')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-old.mp4')).getByText('2026-01-01')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-keep.pdf')).getByText('永久')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-a.txt')).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-keep.pdf')).getByText('12')).toBeInTheDocument()
  })

  it('「有效」二字绝不出现在状态列（backlog：后端 file_status 前不做承诺）', async () => {
    renderPage()
    await screen.findByText('a.txt')
    expect(screen.queryByText('有效')).toBeNull()
  })

  it('链接列：仅展示中段省略文本，title 保留全 URL；列表渲染不发任何探测请求（零 N+1）', async () => {
    renderPage()
    const cell = await screen.findByTestId(`share-url-${LONG_TOKEN}`)
    const fullUrl = shareFullUrl(LONG_TOKEN)
    expect(cell.textContent).toContain('…')
    expect(cell.textContent).not.toBe(fullUrl)
    expect(cell.getAttribute('title')).toBe(fullUrl)
    // 无逐行 meta/verify 探测：除列表（与外壳 usage）外零 GET
    expect(requests.filter((r) => r.method === 'GET' && r.url.startsWith('/api/v1/public'))).toHaveLength(0)
  })

  it('已撤销行不显示撤销钮；未到期/已过期行显示', async () => {
    renderPage()
    await screen.findByText('a.txt')
    expect(within(screen.getByTestId('share-row-gone.zip')).queryByRole('button', { name: '撤销' })).toBeNull()
    expect(within(screen.getByTestId('share-row-a.txt')).getByRole('button', { name: '撤销' })).toBeInTheDocument()
    expect(within(screen.getByTestId('share-row-old.mp4')).getByRole('button', { name: '撤销' })).toBeInTheDocument()
  })
})

function shareFullUrl(token: string): string {
  return `${window.location.origin}/d/${token}`
}

describe('middleEllipsis 纯函数', () => {
  it('超限中段省略，未超限原样', () => {
    expect(middleEllipsis('short')).toBe('short')
    const long = 'http://localhost:3000/d/' + 'x'.repeat(40)
    const out = middleEllipsis(long)
    expect(out).toContain('…')
    expect(out.length).toBeLessThan(long.length)
    expect(out.startsWith('http://')).toBe(true)
    expect(out.endsWith('x'.repeat(9))).toBe(true)
  })
})

describe('复制：clipboard 全 URL + toast；拒绝回退选中（ShareDialog 同纪律）', () => {
  it('点「复制」→ writeText(shareUrl(token)) + toast「链接已复制到剪贴板。」', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await screen.findByText('a.txt')
    await userEvent.click(within(screen.getByTestId('share-row-a.txt')).getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shareFullUrl(LONG_TOKEN)))
    expect(await screen.findByText('链接已复制到剪贴板。')).toBeInTheDocument()
  })

  it('clipboard 拒绝 → 行内隐藏 input 全文被选中，不弹错误 toast', async () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
      configurable: true,
    })
    renderPage()
    await screen.findByText('a.txt')
    const input = screen.getByTestId(`share-copy-input-${LONG_TOKEN}`) as HTMLInputElement
    expect(input.value).toBe(shareFullUrl(LONG_TOKEN))
    await userEvent.click(within(screen.getByTestId('share-row-a.txt')).getByRole('button', { name: '复制' }))
    await waitFor(() => {
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(input.value.length)
    })
    expect(screen.queryByText('链接已复制到剪贴板。')).toBeNull()
  })
})

describe('撤销：直按（brief 定夺）→ DELETE 204 → toast + shares 键失效 → 重取行内更新非消失', () => {
  it('成功：DELETE /api/v1/shares/:token + toast「分享已撤销。」+ invalidate shares 键；重取后行显示已撤销、撤销钮消失', async () => {
    renderPage()
    await screen.findByText('old.mp4')
    await userEvent.click(within(screen.getByTestId('share-row-old.mp4')).getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(sent('DELETE', /^\/api\/v1\/shares\/tokExp$/)).toBeTruthy())
    expect(await screen.findByText('分享已撤销。')).toBeInTheDocument()
    expect(invalidatedKeys()).toContainEqual(['shares'])
    // invalidate(['shares']) → 重取（桩已把 tokExp 行翻为 revoked=true）：行更新非消失
    const row = await screen.findByTestId('share-row-old.mp4')
    await waitFor(() => expect(within(row).getByText('已撤销')).toBeInTheDocument())
    expect(within(row).queryByRole('button', { name: '撤销' })).toBeNull()
    expect(within(row).queryByText('已过期')).toBeNull() // 事实态优先：revoked 压过过期判定
  })

  it('失败：404 not_found → translateError 中文 toast 透传，不做失效', async () => {
    revokeRes = { status: 404, body: { error: 'not_found' } }
    renderPage()
    await screen.findByText('a.txt')
    await userEvent.click(within(screen.getByTestId('share-row-a.txt')).getByRole('button', { name: '撤销' }))
    expect(await screen.findByText('分享不存在或已删除。')).toBeInTheDocument()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('加载/错误/空态', () => {
  it('列表挂起：骨架 + 加载文案（aria-busy），落定消失', async () => {
    let release: () => void = () => undefined
    holdList = new Promise<void>((resolve) => { release = resolve })
    renderPage()
    const loading = await screen.findByTestId('shares-loading')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading).toHaveTextContent('正在读取分享列表…')
    release()
    await screen.findByText('a.txt')
    expect(screen.queryByTestId('shares-loading')).toBeNull()
  })

  it('500：destructive Alert 中文兜底', async () => {
    listStatus = 500
    renderPage()
    const alert = await screen.findByTestId('shares-error')
    expect(alert).toHaveTextContent('服务暂时遇到问题，请稍后重试。')
  })

  it('空态：Empty + brief 文案逐字', async () => {
    listBody = { items: [] }
    renderPage()
    const empty = await screen.findByTestId('empty')
    expect(within(empty).getByText('还没有创建过分享。')).toBeInTheDocument()
    expect(within(empty).getByText('在文件上右键选择「分享」生成链接。')).toBeInTheDocument()
  })
})

describe('Dock 导航：我的分享条目渲染 + 点击进 /shares', () => {
  it('dock 渲染「我的分享」按钮；点击导航 /shares', async () => {
    renderShell(<Dock />)
    const button = await screen.findByRole('button', { name: '我的分享' })
    await userEvent.click(button)
    expect(screen.getByTestId('location')).toHaveTextContent('/shares')
  })

  it('第一组顺序：全部文件/回收站/我的分享/搜索（dock 条目 id 序）', async () => {
    renderShell(<Dock />)
    await screen.findByRole('button', { name: '我的分享' })
    // GlassDock 条目钮：label 走 aria-label+title，文本节点为空——按 aria-label 读序。
    const labels = [...screen.getByTestId('dock').querySelectorAll('button')]
      .map((b) => b.getAttribute('aria-label'))
      .filter((l): l is string => Boolean(l))
    expect(labels.slice(0, 4)).toEqual(['全部文件', '回收站', '我的分享', '搜索'])
  })
})

describe('路由注册：/shares 进 AppLayout（authed），锚点与 /trash 对齐', () => {
  it('已登录进 /shares：shares-route 锚点 + 真实页面 + GET /api/v1/shares 发出', async () => {
    authActions.setSession('tok', new Date(Date.now() + 3_600_000).toISOString(), {
      id: 1, username: 'tester', email: 't@example.com', created_at: '2026-01-01T00:00:00Z',
    })
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/shares'] })
    render(<AppProviders router={router} />)
    await screen.findByTestId('shares-page')
    expect(screen.getByTestId('shares-route')).toBeInTheDocument()
    await waitFor(() => expect(sent('GET', /^\/api\/v1\/shares$/)).toBeTruthy())
  })

  it('未登录访问 /shares：守卫弹回 /login', async () => {
    authActions.clear()
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/shares'] })
    render(<AppProviders router={router} />)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})
