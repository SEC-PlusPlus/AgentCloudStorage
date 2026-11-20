// Task 3-C 锚（RED 先行）：根目录仪表盘带（最近添加 + 存储环）。
// 纯逻辑：recentCards（页 1 取前 N、夹序输入不重排断言、limit 边界）、usagePercent（0/半/满/溢出/
// quota≤0 除零钳位表驱动）；formatRelative 边界表在 lib/format.test.ts 同任务追加。
// 组件：卡片=icon+名称+大小+相对时间、点击=openPreview 同缝（onOpen 上抛 mergeRows 同源 FileRow）、
// ring=ProgressCircle 百分比文本/aria-valuenow、usage 缺位=无环、双缺位=渲染 null。
// FilesPage 接线（abc-1 零新请求）：仅 folderId===0 且非搜索态渲染；10 文件页 → 卡片 ≤6；
// 文件夹行永不进带（['files',0,1] 缓存按 API 形态 files-only，行为级钉）；['files',0,1] 只读快照
// 不请求、['usage'] 同 key 共享订阅（缓存命中=fresh，零新请求，fetch 路由层断言均保留）；?page=2 深链无页 1 缓存 → 环独降格且**不回补** page=1 请求；
// 带在场时列表 max-h 变量=基线+STRIP_HEIGHT_PX（单源常量，杜绝两套魔法数——brief Step 2）。
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesPage } from './FilesPage'
import { FilesTable, LIST_SCROLL_OFFSET_PX } from './FilesTable'
import { RecentStrip, recentCards, usagePercent, STRIP_HEIGHT_PX, type UsageCache } from './RecentStrip'
import { resetUploadManager } from './useUploadManager'
import type { FileItem } from '@/api/storage'
import type { FileRow } from './useFileRows'

// 预览内容走真实 fetch 桩会进 client.request 的 blob 分支——与 preview-sheet.test 同纪律，
// 内容三函数局部 mock（listFiles/listFolders 等保持真实实现，继续经全局 fetch 桩路由）。
vi.mock('@/api/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/storage')>()
  return {
    ...actual,
    fetchFileContent: vi.fn(() => Promise.resolve(new Blob(['png'], { type: 'image/png' }))),
    fetchTextPreview: vi.fn(() => Promise.resolve({ blob: new Blob(['正文'], { type: 'text/plain' }), truncated: false })),
    downloadFile: vi.fn(() => Promise.resolve()),
  }
})

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

/**
 * 今日本地正午 ISO（终评修波 #5 防午夜闪断）：旧 hoursAgo(1) 在 00:00–01:00 运行会跨过日历日界
 * →「今天」断言红。本地正午=日历日差恒 0（formatRelative 按本地日历日归零判定，与运行墙钟无关）；
 * new Date(y,m,d,12) 本地构造→toISOString→再解析必落同一天，时区安全（lib/format.test.ts 同法）。
 */
const todayNoonIso = (): string => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).toISOString()
}

const fileItem = (id: number, name: string, contentType: string, size = 1024, createdAt = '2026-03-03T12:00:00Z'): FileItem => ({
  id, folder_id: 0, original_name: name, size, content_type: contentType, created_at: createdAt,
})

const FILE_A = fileItem(10, 'a.txt', 'text/plain', 1536)
const FILE_PNG = fileItem(12, 'photo.png', 'image/png', 2048, todayNoonIso()) // 今日正午 → 「今天」（任何墙钟时刻稳定）

let filesBody: unknown = { items: [FILE_A, FILE_PNG], pagination: { page: 1, page_size: 20, total: 2 } }
let foldersBody: unknown = {
  items: [{ id: 7, parent_id: 0, name: '照片', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-05-05T00:00:00Z' }],
}

let impl: (input: RequestInfo | URL) => Promise<Response> = defaultImpl

function defaultImpl(input: RequestInfo | URL): Promise<Response> {
  const url = String(input)
  if (url.startsWith('/api/v1/files/search')) return Promise.resolve(jsonResponse(200, { items: [], pagination: { page: 1, page_size: 20, total: 0 } }))
  if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(200, filesBody))
  if (url.startsWith('/api/v1/folders')) return Promise.resolve(jsonResponse(200, foldersBody))
  if (url.startsWith('/api/v1/storage/usage')) return Promise.resolve(jsonResponse(200, { used_bytes: 5 * 1024 ** 3, quota_bytes: 10 * 1024 ** 3 }))
  return Promise.reject(new Error(`unexpected fetch: ${url}`))
}

const fetchMock = vi.fn((input: RequestInfo | URL) => impl(input))

let queryClient: QueryClient

function renderPage(entry = '/files', seed?: (client: QueryClient) => void) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed?.(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * FilesTable 内滚帧元素（display:contents 包装层）的 --file-list-max-h 值。
 * vendored Table 直渲染 div[data-slot=table-container]（无中间壳，见 table.js:124-137）→ parentElement 即帧元素。
 */
function frameMaxHeightVar(): string {
  const container = document.querySelector('[data-slot="table-container"]') as HTMLElement | null
  expect(container).not.toBeNull()
  const frame = container!.parentElement as HTMLElement
  return frame.style.getPropertyValue('--file-list-max-h')
}

const USAGE: UsageCache = { used_bytes: 5 * 1024 ** 3, quota_bytes: 10 * 1024 ** 3 }

beforeEach(() => {
  filesBody = { items: [FILE_A, FILE_PNG], pagination: { page: 1, page_size: 20, total: 2 } }
  foldersBody = {
    items: [{ id: 7, parent_id: 0, name: '照片', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-05-05T00:00:00Z' }],
  }
  impl = defaultImpl
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  resetUploadManager()
  // jsdom 无 createObjectURL（preview-sheet.test 同纪律）——点卡片开预览的 img 分支需要
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  impl = defaultImpl
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetUploadManager()
})

describe('recentCards（纯函数：页 1 取前 N，服务端已序不重排，文件夹不入卡片域）', () => {
  const page1: FileItem[] = [
    fileItem(5, 'e.bin', 'application/octet-stream'),
    fileItem(9, 'i.bin', 'application/octet-stream'),
    fileItem(2, 'b.bin', 'application/octet-stream'),
    fileItem(7, 'g.bin', 'application/octet-stream'),
    fileItem(1, 'a.bin', 'application/octet-stream'),
    fileItem(4, 'd.bin', 'application/octet-stream'),
    fileItem(8, 'h.bin', 'application/octet-stream'),
    fileItem(3, 'c.bin', 'application/octet-stream'),
  ] // created_at 故意夹序（非 DESC 非 ASC）——函数若偷偷重排，输出 id 序列必变

  it('缺省 limit=6：取前 6、保持输入顺序（无重排）', () => {
    expect(recentCards(page1).map((item) => item.id)).toEqual([5, 9, 2, 7, 1, 4])
  })

  it('自定义 limit 生效；limit≥长度返回全部；limit≤0 返回空', () => {
    expect(recentCards(page1, 3).map((item) => item.id)).toEqual([5, 9, 2])
    expect(recentCards(page1, 100)).toHaveLength(page1.length)
    expect(recentCards(page1, 0)).toEqual([])
    expect(recentCards(page1, -2)).toEqual([])
  })

  it('空页 → 空数组', () => {
    expect(recentCards([])).toEqual([])
  })
})

describe('usagePercent（纯函数：0..100 钳位，quota≤0 恒 0 不除零）', () => {
  const table: Array<[used: number, quota: number, want: number]> = [
    [0, 100, 0],
    [50, 100, 50],
    [100, 100, 100],
    [150, 100, 100], // 超配钳到 100
    [-10, 100, 0], // 负用量钳到 0
    [1, 3, 33],
    [2, 3, 67], // 四舍五入
    [999, 0, 0], // quota=0 除零防御
    [999, -1, 0], // 负 quota 同防
    [0, 0, 0],
  ]
  it.each(table)('used=%s quota=%s → %s', (used, quota, want) => {
    expect(usagePercent(used, quota)).toBe(want)
  })
})

describe('RecentStrip（纯呈现件：卡片字段/点击同缝/环独降格/双缺位不渲染）', () => {
  it('渲染卡片（名称+大小+相对时间）与环百分比文本；文件夹名不出现', () => {
    render(<RecentStrip cards={[FILE_A, FILE_PNG]} usage={USAGE} onOpen={() => undefined} />)
    const strip = screen.getByTestId('recent-strip')
    expect(within(strip).getByText('a.txt')).toBeInTheDocument()
    expect(within(strip).getByText('photo.png')).toBeInTheDocument()
    // 副行=「大小 · 相对时间」单节点合成文本（regex 匹配整行）
    expect(within(strip).getByText(/1\.5 KB · 2026-03-03/)).toBeInTheDocument() // FILE_A=7 天外回退日期（固定 ISO 日，无墙钟依赖）
    expect(within(strip).getByText(/2\.0 KB · 今天/)).toBeInTheDocument() // FILE_PNG=今日正午（修波#5：午界闪断根除）
    expect(within(strip).getByText('50%')).toBeInTheDocument()
    expect(within(strip).queryByText('照片')).toBeNull()
  })

  it('点击卡片 → onOpen 收到 mergeRows 同构 FileRow（openPreview 同缝）', async () => {
    const onOpen = vi.fn()
    render(<RecentStrip cards={[FILE_A]} usage={USAGE} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: /a\.txt/ }))
    const want: Partial<FileRow> = {
      kind: 'file', id: 10, name: 'a.txt', folderId: 0,
      sizeBytes: 1536, sizeText: '1.5 KB', contentType: 'text/plain',
    }
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject(want)
  })

  it('ring 消费 ProgressCircle：role=progressbar + aria-valuenow=百分比', () => {
    render(<RecentStrip cards={[]} usage={USAGE} onOpen={() => undefined} />)
    const ring = screen.getByTestId('usage-ring')
    expect(ring).toHaveAttribute('aria-valuenow', '50')
    expect(within(ring).getByText('50%')).toBeInTheDocument()
  })

  it('usage 缺位：只出卡片不出环；双缺位（无卡片且无 usage）→ 渲染 null', () => {
    const { rerender, container } = render(<RecentStrip cards={[FILE_A]} usage={null} onOpen={() => undefined} />)
    expect(screen.getByTestId('recent-strip')).toBeInTheDocument()
    expect(screen.queryByTestId('usage-ring')).toBeNull()
    rerender(<RecentStrip cards={[]} usage={null} onOpen={() => undefined} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('FilesTable listScrollOffsetPx（带高扣减单源缝）', () => {
  it('缺省=基线；传入=基线+带高时 CSS 变量随动（一个数源、无第二魔法数）', () => {
    const rows: FileRow[] = [
      { kind: 'file', id: 10, name: 'a.txt', folderId: 0, sizeBytes: 1536, sizeText: '1.5 KB', dateText: '2026-03-03', contentType: 'text/plain' },
    ]
    const { rerender } = render(<FilesTable rows={rows} />)
    expect(frameMaxHeightVar()).toBe(`calc(100vh - ${LIST_SCROLL_OFFSET_PX}px)`)
    rerender(<FilesTable rows={rows} listScrollOffsetPx={LIST_SCROLL_OFFSET_PX + STRIP_HEIGHT_PX} />)
    expect(frameMaxHeightVar()).toBe(`calc(100vh - ${LIST_SCROLL_OFFSET_PX + STRIP_HEIGHT_PX}px)`)
  })
})

describe('FilesPage 接线：仅根浏览态出带；缓存读取零新请求', () => {
  it('根目录浏览：带出现、卡片≤6、文件夹不进带、环=缓存值、max-h 扣带高、不发 usage/页1 之外请求', async () => {
    filesBody = {
      items: Array.from({ length: 10 }, (_, i) => fileItem(101 + i, `f${i + 1}.bin`, 'application/octet-stream')),
      pagination: { page: 1, page_size: 20, total: 10 },
    }
    renderPage('/files', (client) => client.setQueryData(['usage'], USAGE))
    const strip = await screen.findByTestId('recent-strip')
    // 卡片上限 6（页 1 有 10 个文件；先 await 卡片上桌——带可先以环独态出现）
    expect(await within(strip).findAllByTestId(/^recent-card-/)).toHaveLength(6)
    // 文件夹行（表格里有「照片」）绝不进带
    expect(await screen.findByText('照片')).toBeInTheDocument()
    expect(within(strip).queryByText('照片')).toBeNull()
    // 环百分比=缓存 ['usage'] 值
    expect(within(strip).getByText('50%')).toBeInTheDocument()
    // max-h 切换：基线 + STRIP_HEIGHT_PX（与常量同源，浏览器校准行走 C13.1）
    expect(frameMaxHeightVar()).toBe(`calc(100vh - ${LIST_SCROLL_OFFSET_PX + STRIP_HEIGHT_PX}px)`)
    // abc-1 零新请求（修波#6 语义）：['usage'] 走与 TopBar 同 key 同 options 的共享订阅——
    // 缓存命中且 staleTime 60s 内为 fresh → 订阅挂载即零请求（fetch 路由钉在此显证不回归）。
    await Promise.resolve()
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('/api/v1/storage/usage'))).toBe(true)
  })

  it("['usage'] 订阅（修波#6）：缓存更新 → 带随动重渲染（旧 getQueryData 快照方案不随动）", async () => {
    renderPage('/files', (client) => client.setQueryData(['usage'], USAGE))
    const strip = await screen.findByTestId('recent-strip')
    // 先等页 1 查询落定（卡片上桌）——排除「files 请求回来恰好触发重渲染追平快照」的偶发通路，
    // 让本锚只可能由 ['usage'] 订阅随动兑现。
    expect(await within(strip).findAllByTestId(/^recent-card-/)).toHaveLength(2)
    expect(within(strip).getByText('50%')).toBeInTheDocument()
    act(() => {
      queryClient.setQueryData(['usage'], { used_bytes: 2 * 1024 ** 3, quota_bytes: 10 * 1024 ** 3 })
    })
    expect(await within(strip).findByText('20%')).toBeInTheDocument()
    // 更新走缓存直写：全程仍零 /storage/usage 请求
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('/api/v1/storage/usage'))).toBe(true)
  })

  it('点卡片=openPreview 同缝：预览 dialog 打开（以文件名命名）', async () => {
    renderPage('/files', (client) => client.setQueryData(['usage'], USAGE))
    const strip = await screen.findByTestId('recent-strip')
    const pngCard = await within(strip).findByTestId('recent-card-12') // 等页 1 落定再点（卡片本体即 button）
    await userEvent.click(pngCard)
    expect(await screen.findByRole('dialog', { name: 'photo.png' })).toBeInTheDocument()
  })

  it('非根（?folder=3）：无带且 max-h 回基线', async () => {
    renderPage('/files?folder=3')
    await screen.findByTestId('row-file:10')
    expect(screen.queryByTestId('recent-strip')).toBeNull()
    expect(frameMaxHeightVar()).toBe(`calc(100vh - ${LIST_SCROLL_OFFSET_PX}px)`)
  })

  it('搜索态（?q=）：无带且 max-h 回基线', async () => {
    impl = (input) => {
      const url = String(input)
      if (url.startsWith('/api/v1/files/search')) {
        return Promise.resolve(jsonResponse(200, { items: [FILE_A], pagination: { page: 1, page_size: 20, total: 1 } }))
      }
      return defaultImpl(input)
    }
    renderPage('/files?q=a')
    await screen.findByTestId('row-file:10')
    expect(screen.queryByTestId('recent-strip')).toBeNull()
    expect(frameMaxHeightVar()).toBe(`calc(100vh - ${LIST_SCROLL_OFFSET_PX}px)`)
  })

  it('?page=2 深链（无页 1 缓存）：环独降格、不回补 page=1 请求、max-h 仍扣带高', async () => {
    filesBody = {
      items: Array.from({ length: 20 }, (_, i) => fileItem(201 + i, `q${i + 1}.bin`, 'application/octet-stream')),
      pagination: { page: 2, page_size: 20, total: 25 },
    }
    renderPage('/files?page=2', (client) => client.setQueryData(['usage'], USAGE))
    const strip = await screen.findByTestId('recent-strip')
    expect(within(strip).queryAllByTestId(/^recent-card-/)).toHaveLength(0) // 无页 1 卡片数据
    expect(within(strip).getByText('50%')).toBeInTheDocument() // 环独在（同带高，无二次跳动）
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('folder_id=0&page=1'))).toBe(false) // 零回补
    expect(frameMaxHeightVar()).toBe(`calc(100vh - ${LIST_SCROLL_OFFSET_PX + STRIP_HEIGHT_PX}px)`)
  })
})
