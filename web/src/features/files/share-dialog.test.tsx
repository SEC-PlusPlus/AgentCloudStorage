// Task W1 属主分享行为锚（jsdom）：owner API 段带 JWT 走 client.request（红线：访客段零 Authorization
// 的既有断言在 share-route.test.tsx，本文件不触碰）+ ShareDialog 全链路（入口→表单→预检→创建→结果态
// →复制/回退→复位）。fetch 桩按 URL+method 路由（actions-flow.test 同纪律）；jsdom origin 已由
// vite.config environmentOptions 钉为 http://localhost:3000。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from 'sonner'
import { createShare, listShares, revokeShare, shareUrl } from '@/api/shares'
import { authActions } from '@/stores/auth'
import { FilesPage } from './FilesPage'

function jsonResponse(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const FILE_A = {
  id: 10, folder_id: 3, original_name: 'a.txt', size: 1536,
  content_type: 'text/plain', created_at: '2026-03-03T12:00:00Z',
}
const FOLDER_7 = { id: 7, parent_id: 3, name: '照片', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-05-05T00:00:00Z' }

const SHARE_ITEM = {
  token: 'sT0k3n-Xy', canonical_url: 'https://secplusplus.xyz/d/sT0k3n-Xy', display_name: 'a.txt',
  expires_at: '2026-12-26T12:00:00Z', download_count: 0, revoked: false,
  created_at: '2026-11-26T12:00:00Z', has_password: true,
}

let filesBody: unknown = { items: [FILE_A], pagination: { page: 1, page_size: 20, total: 1 } }
let foldersBody: unknown = { items: [FOLDER_7] }
let createShareRes: { status: number; body?: unknown } = { status: 201, body: SHARE_ITEM }
let listRes: { status: number; body?: unknown } = { status: 200, body: { items: [SHARE_ITEM] } }
let revokeRes: { status: number; body?: unknown } = { status: 204 }

interface Sent { url: string; method: string; body?: string; authorization: string | null }
let requests: Sent[] = []

function impl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  requests.push({
    url, method,
    body: typeof init?.body === 'string' ? init.body : undefined,
    // 归一化读取（RF1 纪律：headers 可为 Record/数组形/Headers 实例，直读会假通过）。
    authorization: new Headers(init?.headers ?? {}).get('authorization'),
  })
  if (method === 'POST' && /^\/api\/v1\/files\/\d+\/shares$/.test(url)) {
    return Promise.resolve(jsonResponse(createShareRes.status, createShareRes.body))
  }
  if (method === 'GET' && url === '/api/v1/shares') {
    return Promise.resolve(jsonResponse(listRes.status, listRes.body))
  }
  if (method === 'DELETE' && /^\/api\/v1\/shares\//.test(url)) {
    return Promise.resolve(jsonResponse(revokeRes.status, revokeRes.body))
  }
  if (url.startsWith('/api/v1/folders') && method === 'GET') return Promise.resolve(jsonResponse(200, foldersBody))
  if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(200, filesBody))
  return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`))
}

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => impl(input, init))

function renderPage(entry = '/files?folder=3') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  )
}

const sent = (method: string, pattern: RegExp): Sent | undefined =>
  requests.find((r) => r.method === method && pattern.test(r.url))

/** 打开 ShareDialog：勾选文件行 → 面板「分享」（入口=DetailPanel，abc-4 裁定；右键菜单锚在 actions-flow）。 */
async function openShareDialog(rowName: string) {
  await userEvent.click(screen.getByRole('checkbox', { name: `选择 ${rowName}` }))
  await userEvent.click(await screen.findByRole('button', { name: '分享' }))
  return screen.findByRole('dialog')
}

beforeEach(() => {
  filesBody = { items: [FILE_A], pagination: { page: 1, page_size: 20, total: 1 } }
  foldersBody = { items: [FOLDER_7] }
  createShareRes = { status: 201, body: SHARE_ITEM }
  listRes = { status: 200, body: { items: [SHARE_ITEM] } }
  revokeRes = { status: 204 }
  requests = []
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  authActions.setSession('tok', new Date(Date.now() + 3_600_000).toISOString(), {
    id: 1, username: 'tester', email: 't@example.com', created_at: '2026-01-01T00:00:00Z',
  })
})

afterEach(() => {
  authActions.clear()
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('api/shares owner 段：client.request 带用户 JWT（红线：只增不改，访客段测试原样在 share-route.test）', () => {
  it('createShare → POST /files/:id/shares，Authorization=Bearer tok；缺省 opts 不发空 password 字段', async () => {
    const item = await createShare(10, {})
    expect(item).toEqual(SHARE_ITEM)
    const post = sent('POST', /^\/api\/v1\/files\/10\/shares$/)
    expect(post).toBeTruthy()
    expect(post?.authorization).toBe('Bearer tok')
    expect(JSON.parse(post?.body ?? '{}')).toEqual({})
  })

  it('createShare 传 password/expires_in → 体逐字段；listShares/revokeShare 同样带 Authorization', async () => {
    await createShare(10, { password: 'pw', expires_in: 3600 })
    expect(JSON.parse(sent('POST', /shares$/)?.body ?? '{}')).toEqual({ password: 'pw', expires_in: 3600 })
    const list = await listShares()
    expect(list.items).toEqual([SHARE_ITEM])
    expect(sent('GET', /^\/api\/v1\/shares$/)?.authorization).toBe('Bearer tok')
    await revokeShare('sT0k3n-Xy')
    const del = sent('DELETE', /^\/api\/v1\/shares\/sT0k3n-Xy$/)
    expect(del?.authorization).toBe('Bearer tok')
    expect(del).toBeTruthy() // 204 → resolve undefined（request 的 204 分支）
  })

  it('shareUrl = `${origin}/d/${token}`（token 原样，不加 query）', () => {
    expect(shareUrl('AbC-123')).toBe(`${window.location.origin}/d/AbC-123`)
  })
})

describe('ShareDialog：面板入口→表单→结果态', () => {
  it('勾选文件行→面板「分享」→ 填密码+选「1 天」→ 创建 → POST 体含 password/expires_in=86400 → 结果态显示 origin+/d/token', async () => {
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')

    await userEvent.type(within(dialog).getByLabelText('访问密码（可选）'), 'secret词')
    await userEvent.selectOptions(within(dialog).getByLabelText('有效期'), '1 天')
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))

    await waitFor(() => {
      const post = sent('POST', /^\/api\/v1\/files\/10\/shares$/)
      expect(post).toBeTruthy()
      expect(JSON.parse(post?.body ?? '{}')).toEqual({ password: 'secret词', expires_in: 86400 })
    })
    // 结果态：完整 URL 呈现（origin 由 jsdom 钉死 http://localhost:3000）
    expect(await within(dialog).findByDisplayValue(`${window.location.origin}/d/sT0k3n-Xy`)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '复制链接' })).toBeInTheDocument()
  })

  it('永久档：body 不含 expires_in；空密码字段省略', async () => {
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))
    await waitFor(() => {
      expect(JSON.parse(sent('POST', /shares$/)?.body ?? '{}')).toEqual({})
    })
  })

  it('复制：clipboard.writeText 收到全 URL + toast；拒绝时回退选中文本不崩', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))
    await within(dialog).findByDisplayValue(`${window.location.origin}/d/sT0k3n-Xy`)
    await userEvent.click(within(dialog).getByRole('button', { name: '复制链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/d/sT0k3n-Xy`))
    expect(await screen.findByText('链接已复制到剪贴板。')).toBeInTheDocument()
  })

  it('clipboard 拒绝（无权限/不存在）→ 回退 input.select()，URL 全文被选中', async () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
      configurable: true,
    })
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))
    const urlInput = (await within(dialog).findByDisplayValue(`${window.location.origin}/d/sT0k3n-Xy`)) as HTMLInputElement
    await userEvent.click(within(dialog).getByRole('button', { name: '复制链接' }))
    await waitFor(() => {
      expect(urlInput.selectionStart).toBe(0)
      expect(urlInput.selectionEnd).toBe(urlInput.value.length)
    })
  })

  it('密码 25 个「汉」（75 字节 ≤64 字符）→ 红字拦截，不发请求；改密码后红字清除可重试', async () => {
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')
    const password = within(dialog).getByLabelText('访问密码（可选）')
    await userEvent.type(password, '汉'.repeat(25))
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('72 字节')
    expect(sent('POST', /shares$/)).toBeUndefined()
    await userEvent.clear(password)
    await userEvent.type(password, 'ok-pw')
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))
    await waitFor(() => expect(sent('POST', /^\/api\/v1\/files\/10\/shares$/)).toBeTruthy())
  })

  it('密码 65 个 ASCII（65 字符 >64，字节未超）→ 字符数拦截，不发请求', async () => {
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')
    await userEvent.type(within(dialog).getByLabelText('访问密码（可选）'), 'A'.repeat(65))
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('64 个字符')
    expect(sent('POST', /shares$/)).toBeUndefined()
  })

  it('409 too_many_shares → 弹窗内联「分享数量已达上限（单文件 20 / 账号 50）。」，保持表单态', async () => {
    createShareRes = { status: 409, body: { error: 'too_many_shares' } }
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('分享数量已达上限（单文件 20 / 账号 50）。')
    expect(within(dialog).getByRole('button', { name: '创建分享' })).toBeInTheDocument()
  })

  it('成功→关闭→再开=复位表单（无旧结果态/无旧密码草稿）；取消钮同关', async () => {
    renderPage()
    await screen.findByText('a.txt')
    const dialog = await openShareDialog('a.txt')
    await userEvent.type(within(dialog).getByLabelText('访问密码（可选）'), 'draft')
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    // 取消关闭后重开：仍是表单态、密码为空
    await userEvent.click(screen.getByRole('button', { name: '分享' }))
    const again = await screen.findByRole('dialog')
    expect(within(again).getByLabelText('访问密码（可选）')).toHaveValue('')
    expect(within(again).queryByDisplayValue(/\/d\//)).toBeNull()
    // 走完成功态后关闭，再开也是新表单
    await userEvent.click(within(again).getByRole('button', { name: '创建分享' }))
    await within(again).findByDisplayValue(`${window.location.origin}/d/sT0k3n-Xy`)
    await userEvent.click(within(again).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: '分享' }))
    const third = await screen.findByRole('dialog')
    expect(within(third).getByRole('button', { name: '创建分享' })).toBeInTheDocument()
  })
})

describe('入口门控：文件夹行不出现分享（面板置灰 + 菜单不渲染由 actions-flow 钉，此处断面板侧）', () => {
  it('勾选文件夹行 → 面板「分享」置灰 aria-disabled，点击不开弹窗', async () => {
    renderPage()
    await screen.findByText('照片')
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 照片' }))
    const share = await screen.findByRole('button', { name: '分享' })
    expect(share).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(share)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
