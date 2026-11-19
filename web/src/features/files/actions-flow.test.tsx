// Task 9 操作集行为锚（jsdom）：缝→mutation→失效 spy 全链路 + 右键菜单开合 + 浮条多选语义 +
// 旧文案逐字（确认弹窗/成功 toast/服务端中文错误透传）。fetch 桩按 URL+method 路由（files-page.test 同纪律）。
// move 三错误（空/非空/自嵌）：自嵌与非空在浏览器 dev 手测矩阵复核，此处以 409 stub 断言文案透传路径。
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { Toaster, toast } from 'sonner'
import { NewFolderDialog } from './NewFolderDialog'
import { FilesPage } from './FilesPage'

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const FILE_A = {
  id: 10, folder_id: 3, original_name: 'a.txt', size: 1536,
  content_type: 'text/plain', created_at: '2026-03-03T12:00:00Z',
}
const FILE_B = {
  id: 12, folder_id: 3, original_name: 'b.txt', size: 512,
  content_type: 'text/plain', created_at: '2026-03-04T12:00:00Z',
}
const FOLDER_7 = { id: 7, parent_id: 3, name: '照片', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-05-05T00:00:00Z' }

let filesBody: unknown = { items: [FILE_A, FILE_B], pagination: { page: 1, page_size: 20, total: 2 } }
let rootFoldersBody: unknown = { items: [{ ...FOLDER_7, parent_id: 0 }] } // MoveDialog 树根子级
let folder7ChildrenBody: unknown = { items: [{ id: 8, parent_id: 7, name: '旅行', created_at: '', updated_at: '2026-06-06T00:00:00Z' }] }
let curFoldersBody: unknown = { items: [FOLDER_7] }

/** 各操作的响应桩（用例可改状态码/错误体）。 */
interface MutationStub { status: number; body?: unknown }
let renameRes: MutationStub = { status: 204 }
let moveRes: MutationStub = { status: 204 }
let trashRes: MutationStub = { status: 204 }
let deleteFolderRes: MutationStub = { status: 204 }
let createFolderRes: MutationStub = { status: 200, body: { id: 9, parent_id: 3, name: '新目录', created_at: '', updated_at: '' } }

interface Sent { url: string; method: string; body?: string }
let requests: Sent[] = []

function impl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  requests.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined })
  if (url.startsWith('/api/v1/files/search')) return Promise.resolve(jsonResponse(200, filesBody))
  if (url.startsWith('/api/v1/files/10/content')) {
    return Promise.resolve({
      ok: true, status: 200, headers: new Headers(),
      blob: async () => new Blob(['内容']),
    } as unknown as Response)
  }
  if (url.startsWith('/api/v1/folders') && method === 'GET') {
    const parentId = new URL(url, 'http://test.local').searchParams.get('parent_id')
    if (parentId === '0') return Promise.resolve(jsonResponse(200, rootFoldersBody))
    if (parentId === '7') return Promise.resolve(jsonResponse(200, folder7ChildrenBody))
    return Promise.resolve(jsonResponse(200, curFoldersBody))
  }
  if (method === 'POST' && url === '/api/v1/folders') {
    return Promise.resolve(jsonResponse(createFolderRes.status, createFolderRes.body))
  }
  if (method === 'PATCH' && /\/api\/v1\/(files|folders)\/\d+\/move$/.test(url)) {
    return Promise.resolve(jsonResponse(moveRes.status, moveRes.body))
  }
  if (method === 'PATCH' && /\/api\/v1\/(files|folders)\/\d+$/.test(url)) {
    return Promise.resolve(jsonResponse(renameRes.status, renameRes.body))
  }
  if (method === 'DELETE' && /\/api\/v1\/folders\/\d+$/.test(url)) {
    return Promise.resolve(jsonResponse(deleteFolderRes.status, deleteFolderRes.body))
  }
  if (method === 'DELETE' && /\/api\/v1\/files\/\d+$/.test(url)) {
    return Promise.resolve(jsonResponse(trashRes.status, trashRes.body))
  }
  if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(200, filesBody))
  return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`))
}

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => impl(input, init))

let queryClient: QueryClient
let invalidateSpy: MockInstance<(options?: { queryKey?: unknown }) => Promise<void>>

function renderPage(entry = '/files?folder=3') {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </MemoryRouter>
      {/* 外壳同款 Toaster：toast 断言需要落地节点（useUploadManager.test 同纪律） */}
      <Toaster />
    </QueryClientProvider>,
  )
}

const sent = (method: string, urlPattern: RegExp): Sent | undefined =>
  requests.find((r) => r.method === method && urlPattern.test(r.url))

const invalidatedKeys: () => unknown[] = () => invalidateSpy.mock.calls.map(([opts]) => (opts as { queryKey?: unknown }).queryKey)

async function selectRow(name: string) {
  await userEvent.click(screen.getByRole('checkbox', { name: `选择 ${name}` }))
}

beforeEach(() => {
  filesBody = { items: [FILE_A, FILE_B], pagination: { page: 1, page_size: 20, total: 2 } }
  rootFoldersBody = { items: [{ ...FOLDER_7, parent_id: 0 }] }
  folder7ChildrenBody = { items: [{ id: 8, parent_id: 7, name: '旅行', created_at: '', updated_at: '2026-06-06T00:00:00Z' }] }
  curFoldersBody = { items: [FOLDER_7] }
  renameRes = { status: 204 }
  moveRes = { status: 204 }
  trashRes = { status: 204 }
  deleteFolderRes = { status: 204 }
  createFolderRes = { status: 200, body: { id: 9, parent_id: 3, name: '新目录', created_at: '', updated_at: '' } }
  requests = []
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
})

afterEach(() => {
  toast.dismiss() // sonner 单例跨用例残留防御（login-flow 同纪律）
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('重命名：浮条→对话框→PATCH→失效/文案', () => {
  it('单选文件 → 浮条重命名 → 预填当前名 → Enter 提交 → renameFile + 旧成功 toast + rename 失效键', async () => {
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await userEvent.click(await screen.findByRole('button', { name: '重命名' }))

    const input = screen.getByRole('textbox', { name: '新名称' })
    expect(input).toHaveValue('a.txt') // 旧 openDialog 预填语义
    await userEvent.clear(input)
    await userEvent.type(input, '改名.txt')
    await userEvent.keyboard('{Enter}') // form 提交=旧 @submit.prevent

    await waitFor(() => expect(sent('PATCH', /\/api\/v1\/files\/10$/)).toBeTruthy())
    expect(JSON.parse(sent('PATCH', /\/api\/v1\/files\/10$/)!.body!)).toEqual({ name: '改名.txt' })
    expect(await screen.findByText('名称已更新。')).toBeInTheDocument() // 旧 toast 文案
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([['folders', 3], ['files', 3], ['search'], ['navTrail']]),
    )
  })

  it('服务端重名 409：中文映射经 toast 透传，弹窗保持打开', async () => {
    renameRes = { status: 409, body: { error: 'folder already exists' } }
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await userEvent.click(await screen.findByRole('button', { name: '重命名' }))
    const input = screen.getByRole('textbox', { name: '新名称' })
    await userEvent.clear(input)
    await userEvent.type(input, 'b.txt')
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByText('当前目录中已存在同名文件夹。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '新名称' })).toBeInTheDocument()
  })
})

describe('移动：树选择器→moveFile→双目录失效（Review Focus #4）', () => {
  it('浮条移动 → MoveDialog 根展开列出一级目录 → 选中 → 确认 → PATCH move + 源/目标/navTrail/usage 失效', async () => {
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await userEvent.click(await screen.findByRole('button', { name: '移动' }))

    // 打开时惰性查询根（parent_id=0）；默认选中根目录（旧 targetID=0）
    await waitFor(() => expect(sent('GET', /\/api\/v1\/folders\?parent_id=0/)).toBeTruthy())
    const rootOption = screen.getByRole('button', { name: '移动到“根目录”' })
    expect(rootOption).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '移动到“照片”' }))
    await userEvent.click(screen.getByRole('button', { name: '确认' }))

    await waitFor(() => expect(sent('PATCH', /\/api\/v1\/files\/10\/move$/)).toBeTruthy())
    expect(JSON.parse(sent('PATCH', /\/api\/v1\/files\/10\/move$/)!.body!)).toEqual({ folder_id: 7 })
    expect(await screen.findByText('项目已移动。')).toBeInTheDocument() // 旧 toast 文案
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([['folders', 3], ['files', 3], ['folders', 7], ['files', 7], ['navTrail'], ['usage']]),
    )
  })

  it('树惰性展开：点展开「照片」才发 parent_id=7 查询，子目录出现且可选中', async () => {
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await userEvent.click(await screen.findByRole('button', { name: '移动' }))
    await screen.findByRole('button', { name: '移动到“照片”' })
    expect(sent('GET', /parent_id=7/)).toBeFalsy() // 收起态不发（惰性）
    await userEvent.click(screen.getByRole('button', { name: '展开 照片' }))
    await waitFor(() => expect(sent('GET', /parent_id=7/)).toBeTruthy())
    expect(await screen.findByRole('button', { name: '移动到“旅行”' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '移动到“旅行”' }))
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(sent('PATCH', /\/api\/v1\/files\/10\/move$/)).toBeTruthy())
    expect(JSON.parse(sent('PATCH', /\/api\/v1\/files\/10\/move$/)!.body!)).toEqual({ folder_id: 8 })
  })

  it('自嵌移动不前端预判：文件夹 move 到自身子目录 → 409 invalid folder move 中文经 toast 呈现', async () => {
    moveRes = { status: 409, body: { error: 'invalid folder move' } }
    renderPage()
    await screen.findByText('照片')
    fireEvent.contextMenu(screen.getByText('照片').closest('tr') as HTMLElement)
    await userEvent.click(await screen.findByRole('menuitem', { name: '移动到…' }))
    // 仅「被移动项自身」也不预判（控制端裁定）：树里正常展示全部目录，旅行要展开照片才惰性出现
    await userEvent.click(await screen.findByRole('button', { name: '展开 照片' }))
    await waitFor(() => expect(sent('GET', /parent_id=7/)).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: '移动到“旅行”' }))
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByText('不能将文件夹移动到自身或其子目录中。')).toBeInTheDocument()
    expect(sent('PATCH', /\/api\/v1\/folders\/7\/move$/)).toBeTruthy()
  })
})

describe('回收站：alert 确认（旧文案逐字）+ 失效', () => {
  it('单选文件 → 浮条移入回收站 → 确认弹窗旧文案 → DELETE files/10 + 旧成功 toast + trash 失效键(含 usage)', async () => {
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await userEvent.click(await screen.findByRole('button', { name: '移入回收站' }))
    expect(screen.getByText('请确认操作')).toBeInTheDocument() // 旧标题
    expect(screen.getByText('将“a.txt”移入回收站？')).toBeInTheDocument() // 旧文案逐字
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(sent('DELETE', /\/api\/v1\/files\/10$/)).toBeTruthy())
    expect(await screen.findByText('文件已移入回收站。')).toBeInTheDocument()
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([['files', 3], ['folders', 3], ['search'], ['trash'], ['usage']]),
    )
  })

  it('文件夹行 → 右键菜单「删除文件夹」→ 旧空目录文案 → 非空 409 中文透传（deleteFolder 走 trash 型失效）', async () => {
    deleteFolderRes = { status: 409, body: { error: 'folder is not empty' } }
    renderPage()
    await screen.findByText('照片')
    fireEvent.contextMenu(screen.getByText('照片').closest('tr') as HTMLElement)
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除文件夹' }))
    expect(await screen.findByText('删除文件夹“照片”？该操作仅能删除空文件夹。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(sent('DELETE', /\/api\/v1\/folders\/7$/)).toBeTruthy())
    expect(await screen.findByText(/文件夹内仍有文件或子文件夹/)).toBeInTheDocument()
  })

  it('多选：浮条显计数、移动/重命名禁用、回收站可批量（顺序 DELETE 两文件 + 新拟多选文案）', async () => {
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await selectRow('b.txt')
    const toolbar = await screen.findByTestId('row-toolbar')
    expect(within(toolbar).getByTestId('toolbar-count')).toHaveTextContent('已选 2 项')
    expect(within(toolbar).getByRole('button', { name: '移动' })).toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '重命名' })).toBeDisabled()
    await userEvent.click(within(toolbar).getByRole('button', { name: '移入回收站' }))
    expect(await screen.findByText('将 2 个项目移入回收站？文件夹需为空才能删除。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => {
      expect(sent('DELETE', /\/api\/v1\/files\/10$/)).toBeTruthy()
      expect(sent('DELETE', /\/api\/v1\/files\/12$/)).toBeTruthy()
    })
    expect(await screen.findByText('已移入回收站 2 个项目。')).toBeInTheDocument()
  })
})

describe('右键菜单：定位打开 + 键盘角色 + 禁用项', () => {
  // Task 12：a.txt（1.5 KiB ≤1MiB）命中旧 :308 正则 → 菜单「问 AI」从恒 disabled 转可用
  it('文件行右键 → role=menu/menuitem 齐备、问 AI 可用（canAsk 合格）；Esc 关闭；重命名项接对话框', async () => {
    renderPage()
    await screen.findByText('a.txt')
    fireEvent.contextMenu(screen.getByText('a.txt').closest('tr') as HTMLElement)

    const menu = await screen.findByRole('menu', { name: '“a.txt”操作菜单' })
    for (const label of ['预览', '下载', '重命名', '移动到…', '移入回收站']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
    const ask = within(menu).getByRole('menuitem', { name: '问 AI' })
    expect(ask).not.toHaveAttribute('data-disabled')

    fireEvent.keyDown(menu, { key: 'Escape' }) // Radix DismissableLayer 的 Esc 通道
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.contextMenu(screen.getByText('a.txt').closest('tr') as HTMLElement)
    await userEvent.click(await screen.findByRole('menuitem', { name: '重命名' }))
    expect(await screen.findByRole('textbox', { name: '新名称' })).toHaveValue('a.txt')
  })

  it('文件夹行右键：无预览/下载/问 AI，删除项=删除文件夹', async () => {
    renderPage()
    await screen.findByText('照片')
    fireEvent.contextMenu(screen.getByText('照片').closest('tr') as HTMLElement)
    const menu = await screen.findByRole('menu', { name: '“照片”操作菜单' })
    expect(within(menu).queryByRole('menuitem', { name: '预览' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: '下载' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: '删除文件夹' })).toBeInTheDocument()
  })
})

describe('下载：仅文件行 + 旧 toast', () => {
  it('浮条下载混选（文件+文件夹）只发文件 content；toast「下载已开始。」', async () => {
    // jsdom 无 createObjectURL——downloadFile 的锚点法需要它，桩之（URL 语义由浏览器手测覆盖）；
    // anchor.click 在 jsdom 会触发 Not-implemented navigation 控制台噪声，同样打桩（真实浏览器手测复核）
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await selectRow('照片')
    const toolbar = await screen.findByTestId('row-toolbar')
    await userEvent.click(within(toolbar).getByRole('button', { name: '下载' }))
    await waitFor(() => expect(sent('GET', /\/api\/v1\/files\/10\/content$/)).toBeTruthy())
    expect(await screen.findByText('下载已开始。')).toBeInTheDocument()
    expect(sent('DELETE', /files/)).toBeFalsy()
  })
})

describe('新建文件夹对话框（Dock 接线消费件）', () => {
  function renderStandalone() {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/files?folder=3']}>
          <NewFolderDialog open onClose={() => undefined} />
        </MemoryRouter>
        <Toaster />
      </QueryClientProvider>,
    )
  }

  it('输入名称 Enter 提交 → POST folders(parent_id=当前 3) → 旧 toast + folders/files 键失效', async () => {
    renderStandalone()
    const input = screen.getByRole('textbox', { name: '文件夹名称' })
    await userEvent.type(input, '新目录')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(sent('POST', /^\/api\/v1\/folders$/)).toBeTruthy())
    expect(JSON.parse(sent('POST', /^\/api\/v1\/folders$/)!.body!)).toEqual({ name: '新目录', parent_id: 3 })
    expect(await screen.findByText('文件夹已创建。')).toBeInTheDocument()
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([['folders', 3], ['files', 3]]))
  })

  it('空/纯空格名：确认禁用不发请求', async () => {
    renderStandalone()
    await userEvent.type(screen.getByRole('textbox', { name: '文件夹名称' }), '   ')
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    expect(sent('POST', /folders/)).toBeFalsy()
  })
})

describe('预览 sheet 接线（Task 10：双击/右键/键盘三路入口 + 头部操作）', () => {
  // a.txt=text/plain → fetchTextPreview 走既有 /files/10/content 桩（无 body/Content-Length →
  // blob.slice 分支），正文「内容」直入 CodePanel；不触碰 createObjectURL。
  it('双击文件行 → dialog 以文件名命名并显文本正文；关闭按钮收起', async () => {
    renderPage()
    await screen.findByText('a.txt')
    fireEvent.dblClick(screen.getByText('a.txt').closest('tr') as HTMLElement)

    const dialog = await screen.findByRole('dialog', { name: 'a.txt' })
    expect(await within(dialog).findByText('内容')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  // Task 12 接线：预览头部「问 AI」= 旧 openAsk「开问答先关预览」（adbcfba:312）逐字语义 →
  // 点它后预览 sheet 让位、向文件提问 sheet 上桌。
  it('右键「预览」→ 同一 sheet；头部「问 AI」可用，点击后预览关闭、问答 sheet 打开', async () => {
    renderPage()
    await screen.findByText('a.txt')
    fireEvent.contextMenu(screen.getByText('a.txt').closest('tr') as HTMLElement)
    await userEvent.click(await screen.findByRole('menuitem', { name: '预览' }))

    const dialog = await screen.findByRole('dialog', { name: 'a.txt' })
    const ask = within(dialog).getByRole('button', { name: '问 AI' })
    expect(ask).not.toHaveAttribute('aria-disabled')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await userEvent.click(ask)
    expect(await screen.findByRole('dialog', { name: '向文件提问' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'a.txt' })).toBeNull())
  })

  it('⑭ 键盘入口：聚焦文件名按钮 Enter → sheet 打开（单击同按钮亦预览，Task 7 双击缝不回归由上文钉）', async () => {
    renderPage()
    await screen.findByText('a.txt')
    const nameButton = screen.getByRole('button', { name: 'a.txt' })
    nameButton.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'a.txt' })).toBeInTheDocument()
  })
})
