// Task 11 回收站行为锚（jsdom）：恢复/永久删除全链路（faked fetch + invalidate spy 用
// actions.ts 真实输出——精确键序断言，非 arrayContaining）+ 原目录 navTrail 命中/未命中兜底
// + 分页接线与越页钳位 + 旧版（adbcfba TrashPage.vue）文案逐字。
// 文案常量在本文件自 `git show adbcfba:web/src/pages/TrashPage.vue` 抄录，改动即败。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { Toaster, toast } from 'sonner'
import { AppProviders } from '@/providers/AppProviders'
import { routeObjects } from '@/routes'
import { navTrailKey } from '@/features/files/crumbs'
import { authActions } from '@/stores/auth'
import { TrashPage } from './TrashPage'

// —— 旧版文案逐字抄录（adbcfba:web/src/pages/TrashPage.vue） ——
const COPY = {
  heading: '回收站',
  count: (total: number) => `${total} 个项目`,
  subtitle: '这里的文件可以恢复，或永久删除。',
  loading: '正在读取回收站…',
  emptyTitle: '回收站是空的',
  emptyDescription: '被移入回收站的文件会显示在这里。',
  warning: '永久删除后无法恢复。恢复的文件会回到原目录；如果原目录不存在，服务端可能无法恢复。',
  dialogTitle: '永久删除文件',
  dialogBody: (name: string) => `永久删除“${name}”？该操作无法撤销。`,
  dialogConfirm: '永久删除',
  dialogCancel: '取消',
  restored: (name: string) => `“${name}”已恢复。`,
  destroyed: (name: string) => `“${name}”已永久删除。`,
  unknownType: '未知类型',
} as const

function jsonResponse(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const TRASH_A = {
  id: 10, folder_id: 7, original_name: 'report.pdf', size: 2048,
  content_type: 'application/pdf', created_at: '2026-01-01T00:00:00Z', deleted_at: '2026-10-05T12:00:00Z',
}
const TRASH_B = {
  id: 11, folder_id: 0, original_name: 'mystery.bin', size: 512,
  content_type: '', created_at: '2026-01-02T00:00:00Z', deleted_at: null,
}

let trashBody: unknown = {
  items: [TRASH_A, TRASH_B],
  pagination: { page: 1, page_size: 20, total: 2 },
}
interface ResStub { status: number; body?: unknown }
let restoreRes: ResStub = { status: 204 }
let permRes: ResStub = { status: 204 }
let holdTrash: Promise<void> | null = null // 加载态用例挂起 GET /trash 用
let trashStatus = 200 // 错误态用例切 500 用

interface Sent { url: string; method: string }
let requests: Sent[] = []

function impl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  requests.push({ url, method })
  if (method === 'GET' && url.startsWith('/api/v1/trash?')) {
    return (holdTrash ?? Promise.resolve()).then(() =>
      trashStatus === 200 ? jsonResponse(200, trashBody) : jsonResponse(trashStatus, { error: 'boom' }),
    )
  }
  if (method === 'GET' && url.startsWith('/api/v1/storage/usage')) {
    return Promise.resolve(jsonResponse(200, { used_bytes: 1024, quota_bytes: 4096 })) // 路由冒烟测试的 AppLayout/TopBar
  }
  if (method === 'POST' && /^\/api\/v1\/files\/\d+\/restore$/.test(url)) {
    return Promise.resolve(jsonResponse(restoreRes.status, restoreRes.body))
  }
  if (method === 'DELETE' && /^\/api\/v1\/trash\/\d+$/.test(url)) {
    return Promise.resolve(jsonResponse(permRes.status, permRes.body))
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

function renderPage(entry = '/trash') {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/trash" element={<><TrashPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  )
}

const sent = (method: string, pattern: RegExp): Sent | undefined =>
  requests.find((r) => r.method === method && pattern.test(r.url))

const invalidatedKeys: () => unknown[] = () =>
  invalidateSpy.mock.calls.map(([opts]) => (opts as { queryKey?: unknown }).queryKey)

beforeEach(() => {
  trashBody = { items: [TRASH_A, TRASH_B], pagination: { page: 1, page_size: 20, total: 2 } }
  restoreRes = { status: 204 }
  permRes = { status: 204 }
  holdTrash = null
  trashStatus = 200
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

describe('列表渲染：表头列集 + 旧版页头/警示文案逐字', () => {
  it('渲染 名称/大小/删除日期/原目录/操作 列与两行数据（formatBytes/formatDate、未知类型、— 兜底）', async () => {
    // T13 carry #20：表头「删除时间」改回旧 verbatim「删除日期」（adbcfba TrashPage.vue:71），文案+测试同步。
    renderPage()
    await screen.findByText('report.pdf')
    for (const header of ['名称', '大小', '删除日期', '原目录', '操作']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    const rowA = screen.getByTestId('trash-row-10')
    expect(within(rowA).getByText('2.0 KB')).toBeInTheDocument()
    expect(within(rowA).getByText('2026-10-05')).toBeInTheDocument() // formatDate(deleted_at)
    const rowB = screen.getByTestId('trash-row-11')
    expect(within(rowB).getByText('未知类型')).toBeInTheDocument() // 旧 `content_type || '未知类型'`
    expect(within(rowB).getByText('—')).toBeInTheDocument() // 旧 date(null)='—'
  })

  // Task 1-A：回收站行类型图标（lib/file-icons 共享逻辑：pdf=rose、octet 兜底=File 淡色）；
  // 容器内滚类 + 吸顶表头（与 FilesTable 同常量）；页容器 1440px/gap-3。
  it('Task 1-A：行类型图标按 file-icons 分流；列表容器 max-h 内滚+thead 吸顶；页容器密度类', async () => {
    renderPage()
    await screen.findByText('report.pdf')
    expect(screen.getByTestId('trash-row-icon-10').className).toContain('text-rose-500') // application/pdf
    expect(screen.getByTestId('trash-row-icon-11').className).toContain('opacity-50') // 未知 ext+空 mime → File 兜底
    const container = screen.getByTestId('trash-row-10').closest('[data-slot="table-container"]')
    expect(container?.className).toContain('max-h-[var(--file-list-max-h)]')
    expect(container?.className).toContain('overflow-y-auto')
    expect(container!.querySelector('thead')!.className).toContain('sticky')
    const page = screen.getByTestId('trash-page')
    expect(page.className).toContain('max-w-[1440px]')
    expect(page.className).toContain('gap-3')
  })

  it('页头 回收站 + N 个项目 + 副标题、底部警示条文案与旧版逐字', async () => {
    renderPage()
    await screen.findByText('report.pdf')
    expect(screen.getByRole('heading', { name: COPY.heading })).toBeInTheDocument()
    expect(screen.getByText('2 个项目')).toBeInTheDocument()
    expect(screen.getByText(COPY.subtitle)).toBeInTheDocument()
    expect(screen.getByTestId('trash-warning')).toHaveTextContent(COPY.warning)
  })
})

describe('加载/错误/空态', () => {
  it('列表挂起时显示旧版加载文案与骨架，落定后消失', async () => {
    let release: () => void = () => undefined
    holdTrash = new Promise<void>((resolve) => { release = resolve })
    renderPage()
    expect(await screen.findByText(COPY.loading)).toBeInTheDocument()
    expect(screen.getByTestId('trash-loading')).toBeInTheDocument()
    release()
    await screen.findByText('report.pdf')
    expect(screen.queryByText(COPY.loading)).toBeNull()
    expect(screen.queryByTestId('trash-loading')).toBeNull()
  })

  it('列表请求 500：destructive Alert 显示中文映射文案', async () => {
    trashStatus = 500
    renderPage()
    const alert = await screen.findByTestId('trash-error')
    expect(alert).toHaveTextContent('服务暂时遇到问题，请稍后重试。')
  })

  it('空回收站：Empty mascot + 旧版两行文案逐字', async () => {
    trashBody = { items: [], pagination: { page: 1, page_size: 20, total: 0 } }
    renderPage()
    const empty = await screen.findByTestId('empty')
    expect(within(empty).getByText(COPY.emptyTitle)).toBeInTheDocument()
    expect(within(empty).getByText(COPY.emptyDescription)).toBeInTheDocument()
  })
})

describe('原目录列：navTrail 缓存命中显名，未命中 #<id> 兜底（不 BFS）', () => {
  it('缓存命中（照片链）→ 显目录名；未命中 → `#<folder_id>`；根目录链 → 根目录', async () => {
    trashBody = {
      items: [
        TRASH_A, // folder 7
        { ...TRASH_B, id: 12, folder_id: 9 }, // folder 9 无缓存
        { ...TRASH_B, id: 11, folder_id: 0, deleted_at: null }, // 根
      ],
      pagination: { page: 1, page_size: 20, total: 3 },
    }
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(navTrailKey(7), [{ id: 0, name: '根目录' }, { id: 7, name: '照片' }])
    queryClient.setQueryData(navTrailKey(0), [{ id: 0, name: '根目录' }])
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/trash']}>
          <TrashPage />
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByText('report.pdf')
    expect(within(screen.getByTestId('trash-row-10')).getByText('照片')).toBeInTheDocument()
    expect(within(screen.getByTestId('trash-row-12')).getByText('#9')).toBeInTheDocument()
    expect(within(screen.getByTestId('trash-row-11')).getByText('根目录')).toBeInTheDocument()
    // 不 BFS：除列表本身外无 folders 请求
    expect(sent('GET', /\/api\/v1\/folders/)).toBeFalsy()
  })
})

describe('分页接线：?page= URL 状态 + 越页钳位', () => {
  it('total=25 → Pagination；点第 2 页 → trash?page=2 请求 + URL ?page=2', async () => {
    trashBody = { items: [TRASH_A], pagination: { page: 1, page_size: 20, total: 25 } }
    renderPage()
    await screen.findByText('report.pdf')
    const nav = await screen.findByTestId('pagination')
    await userEvent.click(within(nav).getByRole('button', { name: '第 2 页' }))
    await waitFor(() => expect(sent('GET', /\/api\/v1\/trash\?page=2/)).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/trash?page=2'))
  })

  it('深链 ?page=9 越界：落定后 replace 回最后有效页（2）并重取', async () => {
    trashBody = { items: [TRASH_A], pagination: { page: 9, page_size: 20, total: 25 } }
    renderPage('/trash?page=9')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/trash?page=2'))
    await waitFor(() => expect(sent('GET', /\/api\/v1\/trash\?page=2/)).toBeTruthy())
  })

  it('total≤page_size 不渲染分页条', async () => {
    renderPage()
    await screen.findByText('report.pdf')
    expect(screen.queryByTestId('pagination')).toBeNull()
  })
})

describe('恢复：直按按钮 → restoreFile → 旧版 toast + restore 失效键（精确序）', () => {
  it('成功：POST files/10/restore + “report.pdf”已恢复。 + [files@folder_id, search, trash, usage]', async () => {
    renderPage()
    await screen.findByText('report.pdf')
    await userEvent.click(within(screen.getByTestId('trash-row-10')).getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(sent('POST', /\/api\/v1\/files\/10\/restore$/)).toBeTruthy())
    expect(await screen.findByText(COPY.restored('report.pdf'))).toBeInTheDocument()
    expect(invalidatedKeys()).toEqual([['files', 7], ['search'], ['trash'], ['usage']])
  })

  it('失败：服务端中文错误 toast 透传，不做任何失效', async () => {
    restoreRes = { status: 404, body: { error: 'file not found in trash' } }
    renderPage()
    await screen.findByText('report.pdf')
    await userEvent.click(within(screen.getByTestId('trash-row-10')).getByRole('button', { name: '恢复' }))
    expect(await screen.findByText('回收站中的文件不存在或已被处理。')).toBeInTheDocument()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('永久删除：alert-dialog 旧文案逐字 → DELETE → 旧版 toast + perm-delete 失效键', () => {
  it('取消不删除；确认后 DELETE trash/10 + “report.pdf”已永久删除。 + [trash, usage] 精确序', async () => {
    renderPage()
    await screen.findByText('report.pdf')
    await userEvent.click(within(screen.getByTestId('trash-row-10')).getByRole('button', { name: '永久删除' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(COPY.dialogTitle)).toBeInTheDocument()
    expect(within(dialog).getByText(COPY.dialogBody('report.pdf'))).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: COPY.dialogCancel }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(sent('DELETE', /\/api\/v1\/trash\//)).toBeFalsy()

    await userEvent.click(within(screen.getByTestId('trash-row-10')).getByRole('button', { name: '永久删除' }))
    // 行按钮与对话框动作同名「永久删除」：必须 within(dialog) 收窄，否则命中行按钮
    const dialog2 = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog2).getByRole('button', { name: COPY.dialogConfirm }))
    await waitFor(() => expect(sent('DELETE', /\/api\/v1\/trash\/10$/)).toBeTruthy())
    expect(await screen.findByText(COPY.destroyed('report.pdf'))).toBeInTheDocument()
    expect(invalidatedKeys()).toEqual([['trash'], ['usage']])
  })

  it('失败：服务端中文错误 toast 透传，不做任何失效', async () => {
    permRes = { status: 404, body: { error: 'file not found in trash' } }
    renderPage()
    await screen.findByText('report.pdf')
    await userEvent.click(within(screen.getByTestId('trash-row-10')).getByRole('button', { name: '永久删除' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: COPY.dialogConfirm }))
    expect(await screen.findByText('回收站中的文件不存在或已被处理。')).toBeInTheDocument()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('路由注册：/trash 占位兑现为真实页面（测试锚点保留）', () => {
  it('已登录进 /trash：trash-route 锚点 + 真实页面渲染（占位文案消失）', async () => {
    authActions.setSession('tok', new Date(Date.now() + 3_600_000).toISOString(), {
      id: 1, username: 'tester', email: 't@example.com', created_at: '2026-01-01T00:00:00Z',
    })
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/trash'] })
    render(<AppProviders router={router} />)
    await screen.findByTestId('trash-page')
    expect(screen.getByTestId('trash-route')).toBeInTheDocument()
    expect(screen.queryByText(/回收站占位/)).toBeNull()
    expect(sent('GET', /\/api\/v1\/trash\?page=1/)).toBeTruthy()
  })

  it('未登录访问 /trash：守卫弹回 /login', async () => {
    authActions.clear()
    const router = createMemoryRouter(routeObjects, { initialEntries: ['/trash'] })
    render(<AppProviders router={router} />)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})
