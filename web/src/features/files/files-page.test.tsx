// Task 7 文件列表页行为锚（jsdom）：FilesTable 行渲染与回调缝（双击预览/右键上下文/勾选上抛——
// Task 9/10 接线点）、Pagination 页码窗口与可达性、FilesPage URL 驱动全景
// （浏览渲染、?page= 翻页、?folder= 导航 + navTrail 追加契约[可用链写回/降级链不回写]、
// ?q= 搜索模式[不发 folders、「N 个结果」]、空态 Empty+mascot、错误 Alert、加载 skeleton）。
// fetch 桩按 URL 前缀路由（控制端裁定：不用位置序，并发顺序不定；同 unauthorized-wiring 修复）。
// Task 8 追加上传接线锚：工具栏「上传文件」/window 级拖放（DropOverlay 计数显隐、投放 POST、搜索态禁用）。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Empty } from '@/components/app/Empty'
import { Pagination, pageItems } from '@/components/app/Pagination'
import { resetUploadManager } from './useUploadManager'
import { FilesPage } from './FilesPage'
import { FilesTable } from './FilesTable'
import { isUsableTrail, navTrailKey, setTrail } from './crumbs'
import type { FileRow } from './useFileRows'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const FILE_A = {
  id: 10, folder_id: 3, original_name: 'a.txt', size: 1536,
  content_type: 'text/plain', created_at: '2026-03-03T12:00:00Z',
}
const FILE_B = {
  id: 11, folder_id: 0, original_name: '报告.pdf', size: 20480,
  content_type: 'application/pdf', created_at: '2026-04-04T12:00:00Z',
}
const FOLDER_7 = {
  id: 7, parent_id: 3, name: '照片', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-05-05T00:00:00Z',
}

let filesBody: unknown = { items: [FILE_A], pagination: { page: 1, page_size: 20, total: 21 } }
let foldersBody: unknown = { items: [FOLDER_7] }
let searchBody: unknown = { items: [FILE_B], pagination: { page: 1, page_size: 20, total: 1 } }

/** 用例可临时替换的实现（默认按 URL 前缀路由，支持 loading/错误态注入）。 */
let impl: (input: RequestInfo | URL) => Promise<Response> = defaultImpl

function defaultImpl(input: RequestInfo | URL): Promise<Response> {
  const url = String(input)
  if (url.startsWith('/api/v1/files/search')) return Promise.resolve(jsonResponse(200, searchBody))
  if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(200, filesBody))
  if (url.startsWith('/api/v1/folders')) return Promise.resolve(jsonResponse(200, foldersBody))
  return Promise.reject(new Error(`unexpected fetch: ${url}`))
}

const fetchMock = vi.fn((input: RequestInfo | URL) => impl(input))

function LocationProbe() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

let queryClient: QueryClient

function renderPage(entry = '/files?folder=3') {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/files" element={<FilesPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  filesBody = { items: [FILE_A], pagination: { page: 1, page_size: 20, total: 21 } }
  foldersBody = { items: [FOLDER_7] }
  searchBody = { items: [FILE_B], pagination: { page: 1, page_size: 20, total: 1 } }
  impl = defaultImpl
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  resetUploadManager() // 上传队列为模块单例（同文件用例间无隔离，手动清）
})

afterEach(() => {
  impl = defaultImpl
  cleanup()
  vi.unstubAllGlobals()
  resetUploadManager()
})

describe('FilesTable：行渲染与回调缝（Task 9/10 接线锚）', () => {
  const rows: FileRow[] = [
    { kind: 'folder', id: 7, name: '照片', sizeText: null, dateText: '2026-05-05' },
    { kind: 'file', id: 10, name: 'a.txt', sizeBytes: 1536, sizeText: '1.5 KB', dateText: '2026-03-03', contentType: 'text/plain' },
  ]

  it('文件夹行前置；文件夹大小「—」；双击文件行 → onPreview；单击文件夹行 → onFolderOpen', async () => {
    const onPreview = vi.fn()
    const onFolderOpen = vi.fn()
    render(<FilesTable rows={rows} onPreview={onPreview} onFolderOpen={onFolderOpen} />)
    const trs = screen.getAllByRole('row')
    expect(trs[1]?.textContent).toContain('照片') // 首数据行 = 文件夹
    expect(trs[2]?.textContent).toContain('a.txt')
    expect(trs[1]?.textContent).toContain('—')

    fireEvent.dblClick(screen.getByText('a.txt')) // 仅 dblclick 事件，不混入 click 噪声
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(onPreview.mock.calls[0]?.[0]).toMatchObject({ kind: 'file', id: 10 })
    await userEvent.click(screen.getByRole('button', { name: '照片' }))
    expect(onFolderOpen).toHaveBeenCalledTimes(1)
    expect(onFolderOpen.mock.calls[0]?.[0]).toMatchObject({ kind: 'folder', id: 7 })
  })

  // 修复轮 1 / Important #3：rows 换引用（翻页/切目录/换搜索词）时若先前有勾选，内部清集
  // 必须经 onSelectionChange([]) 上抛——否则 T9/T10 拿陈旧集合做批量操作。
  it('rows 换引用 + 先前有勾选 → 清集并上抛空集合；勾选框态同步复位', async () => {
    const onSelectionChange = vi.fn()
    const rowsA: FileRow[] = [
      { kind: 'file', id: 10, name: 'a.txt', sizeBytes: 1024, sizeText: '1.0 KB', dateText: '2026-03-03', contentType: 'text/plain' },
    ]
    const rowsB: FileRow[] = [
      { kind: 'file', id: 20, name: 'b.txt', sizeBytes: 2048, sizeText: '2.0 KB', dateText: '2026-03-04', contentType: 'text/plain' },
    ]
    const { rerender } = render(<FilesTable rows={rowsA} onSelectionChange={onSelectionChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 a.txt' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith([rowsA[0]])

    rerender(<FilesTable rows={rowsB} onSelectionChange={onSelectionChange} />)
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('checkbox', { name: '选择 b.txt' })).not.toBeChecked()

    // 无勾选时换引用：不空报（避免噪声回调）
    onSelectionChange.mockClear()
    const rowsC: FileRow[] = [
      { kind: 'file', id: 30, name: 'c.txt', sizeBytes: 3072, sizeText: '3.0 KB', dateText: '2026-03-05', contentType: 'text/plain' },
    ]
    rerender(<FilesTable rows={rowsC} onSelectionChange={onSelectionChange} />)
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('右键行 → onContext(row, {x,y}) 并 preventDefault；勾选 → onSelectionChange 增删同步', async () => {
    const onContext = vi.fn()
    const onSelectionChange = vi.fn()
    render(<FilesTable rows={rows} onContext={onContext} onSelectionChange={onSelectionChange} />)
    const fileRow = screen.getByText('a.txt').closest('tr')
    expect(fileRow).not.toBeNull()
    fireEvent.contextMenu(fileRow as HTMLElement)
    expect(onContext).toHaveBeenCalledTimes(1)
    expect(onContext.mock.calls[0]?.[0]).toMatchObject({ kind: 'file', id: 10 })
    expect(onContext.mock.calls[0]?.[1]).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })

    await userEvent.click(screen.getByRole('checkbox', { name: '选择 a.txt' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith([rows[1]])
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 a.txt' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
  })

  it('回调缝全部缺省时可独立渲染（no-op 默认，接线缺位不报错）', () => {
    render(<FilesTable rows={rows} />)
    fireEvent.dblClick(screen.getByText('a.txt'))
    fireEvent.contextMenu(screen.getByText('照片').closest('tr') as HTMLElement)
    expect(screen.getByText('a.txt')).toBeInTheDocument()
  })
})

describe('Pagination：页码窗口 + 可达性', () => {
  it('pageItems：小总量全显；大总量折叠首尾+当前±1', () => {
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageItems(8, 20)).toEqual([1, '…', 7, 8, 9, '…', 20])
    expect(pageItems(1, 20)).toEqual([1, 2, '…', 20])
    expect(pageItems(20, 20)).toEqual([1, '…', 19, 20])
  })

  it('当前页 aria-current=page 且禁用；上一页/下一页边界禁用；点击回调目标页', async () => {
    const onChange = vi.fn()
    render(<Pagination page={1} total={25} onChange={onChange} />)
    const current = screen.getByRole('button', { name: '第 1 页' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onChange).toHaveBeenCalledWith(2)

    cleanup()
    render(<Pagination page={2} total={25} onChange={onChange} />)
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '第 1 页' }))
    expect(onChange).toHaveBeenCalledWith(1)
  })
})

describe('FilesPage：URL 驱动全景', () => {
  it('浏览：文件夹前置 + 格式化字段；下一页发 page=2（URL 保留 folder）', async () => {
    renderPage()
    expect(await screen.findByText('照片')).toBeInTheDocument()
    expect(screen.getByText('a.txt')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
    expect(screen.getByText('2026-05-05')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: '下一页' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/v1/files?folder_id=3&page=2'))).toBe(true),
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/files?folder=3&page=2')
  })

  it('单击文件夹行：URL → ?folder=7（清 q/page）+ 可用链 setTrail 追加（含前缀回填）', async () => {
    renderPage()
    await screen.findByText('照片')
    setTrail(queryClient, 3, [
      { id: 0, name: '根目录' },
      { id: 3, name: '文档' },
    ])
    await userEvent.click(screen.getByRole('button', { name: '照片' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/files?folder=7'))
    expect(queryClient.getQueryData(navTrailKey(7))).toEqual([
      { id: 0, name: '根目录' },
      { id: 3, name: '文档' },
      { id: 7, name: '照片' },
    ])
  })

  it('降级链（name 空）不回写半截 navTrail：只更新 URL（isUsableTrail 契约，留给 BFS 自愈）', async () => {
    renderPage()
    await screen.findByText('照片')
    queryClient.setQueryData(navTrailKey(3), [{ id: 3, name: '' }])
    await userEvent.click(screen.getByRole('button', { name: '照片' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/files?folder=7'))
    expect(queryClient.getQueryData(navTrailKey(7))).toBeUndefined()
  })

  it('搜索模式：?q= 走 files/search、不发 folders 浏览请求、「N 个结果」计数、无文件夹行', async () => {
    renderPage('/files?q=报告')
    expect(await screen.findByText('报告.pdf')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/v1/files/search?q='))).toBe(true)
    expect(fetchMock.mock.calls.every(([u]) => !String(u).startsWith('/api/v1/folders'))).toBe(true)
    expect(screen.getByTestId('search-count')).toHaveTextContent('1 个结果')
    expect(screen.queryByText('照片')).toBeNull()
  })

  it('空目录：Empty + mascot；搜索无结果：Empty + 清除搜索动作', async () => {
    filesBody = { items: [], pagination: { page: 1, page_size: 20, total: 0 } }
    foldersBody = { items: [] }
    renderPage()
    const empty = await screen.findByTestId('empty')
    expect(screen.getByText('这个目录还没有内容')).toBeInTheDocument()
    expect(empty.querySelector('img')).toHaveAttribute('src', '/images/cloud-gopher-pixel.png')
    cleanup()

    searchBody = { items: [], pagination: { page: 1, page_size: 20, total: 0 } }
    renderPage('/files?q=zzz')
    expect(await screen.findByText('没有找到「zzz」相关文件')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/files'))
  })

  it('错误态：列表 5xx → Alert（translateError 文案），不渲染 Empty', async () => {
    impl = (input) => {
      const url = String(input)
      if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(500, { error: 'db down' }))
      return Promise.resolve(jsonResponse(200, foldersBody))
    }
    renderPage()
    const alert = await screen.findByTestId('files-error')
    expect(alert).toHaveTextContent('服务暂时遇到问题，请稍后重试。')
    expect(screen.queryByTestId('empty')).toBeNull()
  })

  it('加载态：pending → skeleton（aria-busy）+ 分页条藏；落定后转真实行 + 分页条', async () => {
    let release: ((v: Response) => void) | undefined
    impl = (input) => {
      const url = String(input)
      if (url.startsWith('/api/v1/files')) return new Promise<Response>((r) => { release = r })
      return Promise.resolve(jsonResponse(200, foldersBody))
    }
    renderPage()
    expect(await screen.findByTestId('files-loading')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('pagination')).toBeNull()
    release?.(jsonResponse(200, filesBody))
    expect(await screen.findByText('a.txt')).toBeInTheDocument()
    expect(await screen.findByTestId('pagination')).toBeInTheDocument()
  })

  it('深链 ?folder=3&page=2 直接按 URL 请求（前进/后退恢复的底层保证）', async () => {
    renderPage('/files?folder=3&page=2')
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('folder_id=3&page=2'))).toBe(true),
    )
  })

  // 修复轮 1 / Important #1：后端对 page>ceil(total/size) 返回 200+空 items——越页不是空目录，
  // 必须回退到最后一有效页（replace，历史不留死页），否则 Empty 假空态 + 分页条不渲染无恢复路径。
  it('越页深链 page=999：回退最后有效页 page=2 并取数，不显假空态', async () => {
    // 忠实模拟后端：越页 → 200 + 空 items（total 仍 21）；page=2 → 真实第二页数据
    impl = (input) => {
      const url = String(input)
      if (url.startsWith('/api/v1/files?folder_id=3&page=2')) {
        return Promise.resolve(jsonResponse(200, { items: [FILE_A], pagination: { page: 2, page_size: 20, total: 21 } }))
      }
      if (url.startsWith('/api/v1/files')) {
        return Promise.resolve(jsonResponse(200, { items: [], pagination: { page: 999, page_size: 20, total: 21 } }))
      }
      if (url.startsWith('/api/v1/folders')) return Promise.resolve(jsonResponse(200, foldersBody))
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    }
    renderPage('/files?folder=3&page=999')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/files?folder=3&page=2'))
    expect(screen.queryByTestId('empty')).toBeNull()
    expect(await screen.findByText('a.txt')).toBeInTheDocument()
    expect(await screen.findByTestId('pagination')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('folder_id=3&page=2'))).toBe(true)
  })

  it('真·空目录（total=0）page=999 保持空态文案、不回退钳位（边界护栏）', async () => {
    filesBody = { items: [], pagination: { page: 999, page_size: 20, total: 0 } }
    foldersBody = { items: [] }
    renderPage('/files?folder=3&page=999')
    expect(await screen.findByTestId('empty')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/files?folder=3&page=999')
  })

  it('搜索模式越页：q=报告&page=5（total=7→1 页）→ page 参数删除回第 1 页', async () => {
    searchBody = { items: [FILE_B], pagination: { page: 5, page_size: 20, total: 7 } }
    renderPage('/files?q=报告&page=5')
    // setSearchParams 会把 query 百分号编码回写（中文关键词），断言用编码形态而非原文
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/files?q=${encodeURIComponent('报告')}`),
    )
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=')
    expect(await screen.findByText('报告.pdf')).toBeInTheDocument()
  })

  // 修复轮 1 / Important #2：写闸与 crumbs.isUsableTrail 同源（内联复制曾丢 typeof name 守卫——
  // 6b 修复轮要防的漂移类）。非字符串 name 的缓存链不得 setTrail 追加。
  it('缓存链含非字符串 name（损坏态）：不回写 navTrail——与 isUsableTrail 同源的显证', async () => {
    renderPage()
    await screen.findByText('照片')
    queryClient.setQueryData(navTrailKey(3), [{ id: 3, name: 5 as unknown as string }])
    await userEvent.click(screen.getByRole('button', { name: '照片' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/files?folder=7'))
    expect(queryClient.getQueryData(navTrailKey(7))).toBeUndefined()
  })

  it('isUsableTrail 谓词本身：尾 id 匹配 + 全链非空字符串名才可用（五分支直测，锁同源契约）', () => {
    expect(isUsableTrail([{ id: 0, name: '根目录' }, { id: 3, name: '文档' }], 3)).toBe(true)
    expect(isUsableTrail([{ id: 3, name: '' }], 3)).toBe(false)
    expect(isUsableTrail([{ id: 3, name: 5 as unknown as string }], 3)).toBe(false)
    expect(isUsableTrail([{ id: 0, name: '根目录' }], 3)).toBe(false) // 尾 id 不符
    expect(isUsableTrail(undefined, 3)).toBe(false)
    expect(isUsableTrail([], 3)).toBe(false)
  })
})

describe('Task 8 上传接线：工具栏入口 / DropOverlay / 搜索态禁用', () => {
  function droppedFile(): File {
    return new File(['x'], '拖入.txt', { type: 'text/plain', lastModified: 1700000000000 })
  }
  function dragInit(files: File[]): Record<string, unknown> {
    // RTL fireEvent 会把非事件字段直接挂到 event 上（dataTransfer 即如此构造）
    return { dataTransfer: { files, types: ['Files'] } }
  }
  const isUploadPost = ([u, init]: unknown[]): boolean =>
    String(u) === '/api/v1/files' && (init as RequestInit | undefined)?.method === 'POST'

  it('浏览模式：拖入显遮罩、离开隐藏（enter/leave 计数归零）、放下发 POST /api/v1/files；按钮可用', async () => {
    renderPage()
    await screen.findByText('照片')
    expect(screen.getByRole('button', { name: '上传文件' })).toBeEnabled()

    fireEvent.dragEnter(window, dragInit([droppedFile()]))
    expect(screen.getByTestId('drop-overlay')).toBeInTheDocument()
    fireEvent.dragLeave(window, dragInit([droppedFile()]))
    expect(screen.queryByTestId('drop-overlay')).toBeNull()

    // 非文件拖入（types 无 Files、files 空）不触发遮罩
    fireEvent.dragEnter(window, { dataTransfer: { files: [], types: ['text/plain'] } })
    expect(screen.queryByTestId('drop-overlay')).toBeNull()

    fireEvent.dragEnter(window, dragInit([droppedFile()]))
    fireEvent.drop(window, dragInit([droppedFile()]))
    expect(screen.queryByTestId('drop-overlay')).toBeNull() // drop 复位深度计数并隐藏
    await waitFor(() => expect(fetchMock.mock.calls.some(isUploadPost)).toBe(true))
  })

  it('搜索态禁止拖入（旧 FileWorkbench onDrop isSearching return）：无遮罩、无上传请求、按钮禁用', async () => {
    renderPage('/files?q=报告')
    expect(await screen.findByText('报告.pdf')).toBeInTheDocument()

    fireEvent.dragEnter(window, dragInit([droppedFile()]))
    expect(screen.queryByTestId('drop-overlay')).toBeNull()
    fireEvent.drop(window, dragInit([droppedFile()]))
    expect(fetchMock.mock.calls.some(isUploadPost)).toBe(false)
    expect(screen.getByRole('button', { name: '上传文件' })).toBeDisabled()
  })
})

describe('Empty：status 语义与三槽', () => {
  it('title + description（role=status 播报）+ action', () => {
    const onClick = vi.fn()
    render(<Empty title="没有文件" description="去上传吧" action={{ label: '上传', onClick }} />)
    expect(screen.getByText('没有文件')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('去上传吧')
    expect(screen.getByRole('button', { name: '上传' })).toBeInTheDocument()
  })
})
