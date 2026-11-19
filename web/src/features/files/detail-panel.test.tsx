// Task 2-B 详情面板行为锚（jsdom）：DetailPanel 纯呈现契约（单行字段/动作回调/禁用门控 aria-disabled+
// tooltip reason 同 PreviewSheet minor ⑮ 模式、多行计数摘要、无选中不渲染、窄屏 hidden+lg: 类钉）
// + FilesPage 接线钉（abc-3 数据源=checkbox 勾选、abc-4 单选浮条隐藏/多选并存、关闭钮=清勾选经
// clearSelectionToken 缝同步复位 checkbox、批量回收站复用既有确认弹窗渠道）。
// TrashPage 侧面板（abc-2 无永久删除）钉在 trash-page.test.tsx（复用其 fetch/路由桩）。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { FileText, Trash2 } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from 'sonner'
import { DetailPanel, type DetailPanelAction, type DetailPanelSubject } from './DetailPanel'
import { FilesPage } from './FilesPage'

function jsonResponse(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

// —— 单元件：纯 props 呈现断言 ——
const subject = (over?: Partial<DetailPanelSubject>): DetailPanelSubject => ({
  key: 'file:10',
  name: 'a.txt',
  icon: FileText,
  toneClass: 'text-emerald-500',
  fields: [
    { label: '类型', value: '文本/代码' },
    { label: '大小', value: '1.5 KB' },
    { label: '修改时间', value: '2026-03-03' },
    { label: '所在目录', value: '文档' },
  ],
  ...over,
})

const action = (over?: Partial<DetailPanelAction>): DetailPanelAction => ({
  label: '预览',
  icon: FileText,
  onClick: vi.fn(),
  ...over,
})

// 单元/接线两段共用模块级 cleanup（RTL 自动清理未启用——vitest 配置 globals:false 惯例）
afterEach(() => cleanup())

describe('DetailPanel 纯呈现契约', () => {
  it('无选中（rows=[]）→ 不渲染 aside（grid 回单栏）', () => {
    const { container } = render(
      <DetailPanel selection={[]} actions={[]} bulkActions={[]} onClose={() => undefined} />,
    )
    expect(container.innerHTML).toBe('')
    expect(screen.queryByTestId('detail-panel')).toBeNull()
  })

  it('单行：大图标托底+名称+元数据行齐全+动作组渲染', () => {
    const actions = [action(), action({ label: '下载' }), action({ label: '重命名' }), action({ label: '移动' }), action({ label: '问 AI' })]
    render(<DetailPanel selection={[subject()]} actions={actions} bulkActions={[]} onClose={() => undefined} />)
    expect(screen.getByTestId('panel-name')).toHaveTextContent('a.txt')
    // 大图标：aria-hidden 装饰节点带 tone 类（配色走 file-icons 色相表，非发明新色）
    expect(screen.getByTestId('panel-icon').className).toContain('text-emerald-500')
    for (const [label, value] of [['类型', '文本/代码'], ['大小', '1.5 KB'], ['修改时间', '2026-03-03'], ['所在目录', '文档']] as const) {
      expect(screen.getByTestId(`panel-field-${label}`)).toHaveTextContent(value)
    }
    for (const label of ['预览', '下载', '重命名', '移动', '问 AI']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('动作点击=回调上抛；disabled 动作 aria-disabled+点击不触发+悬停 tooltip 显 reason（⑮ 模式）', async () => {
    const ok = action()
    const blocked = action({ label: '下载', onClick: vi.fn(), disabled: true, reason: '文件夹不可下载。' })
    render(<DetailPanel selection={[subject()]} actions={[ok, blocked]} bulkActions={[]} onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(ok.onClick).toHaveBeenCalledTimes(1)
    const dl = screen.getByRole('button', { name: '下载' })
    expect(dl).toHaveAttribute('aria-disabled', 'true')
    // 同 PreviewSheet 先例：hover 在前断 reason，click 在后验证守卫；不加 unhover（Radix 层 pointer-events 干扰）
    await userEvent.hover(dl)
    expect(await screen.findByText('文件夹不可下载。')).toBeInTheDocument()
    await userEvent.click(dl)
    expect(blocked.onClick).not.toHaveBeenCalled()
  })

  it('多行：「已选 N 项」计数摘要+批量动作；单行元数据/单行动作组不渲染', () => {
    const second = subject({ key: 'file:11', name: 'b.txt' })
    const bulk = [action({ label: '下载全部' }), action({ label: '移入回收站', icon: Trash2 })]
    render(<DetailPanel selection={[subject(), second]} actions={[action()]} bulkActions={bulk} onClose={() => undefined} />)
    expect(screen.getByTestId('panel-count')).toHaveTextContent('已选 2 项')
    expect(screen.getByRole('button', { name: '下载全部' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移入回收站' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '预览' })).toBeNull()
    expect(screen.queryByTestId('panel-field-大小')).toBeNull()
  })

  it('关闭钮 → onClose 上抛（清勾选由页侧接线兑现）', async () => {
    const onClose = vi.fn()
    render(<DetailPanel selection={[subject()]} actions={[action()]} bulkActions={[]} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // 窄屏隐藏钉（brief Step 1「<lg hidden 类」）：jsdom 不跑媒体查询，钉静态类组合=hidden + lg:*
  it('aside 窄屏隐藏类：hidden 基底 + lg: 恢复（<lg 单栏，面板不占位）', () => {
    render(<DetailPanel selection={[subject()]} actions={[action()]} bulkActions={[]} onClose={() => undefined} />)
    const aside = screen.getByTestId('detail-panel')
    expect(aside.className).toContain('hidden')
    expect(aside.className).toContain('lg:block')
  })
})

// —— FilesPage 接线钉 ——
const FILE_A = {
  id: 10, folder_id: 3, original_name: 'a.txt', size: 1536,
  content_type: 'text/plain', created_at: '2026-03-03T12:00:00Z',
}
const FILE_PDF = {
  id: 11, folder_id: 0, original_name: '报告.pdf', size: 20480,
  content_type: 'application/pdf', created_at: '2026-04-04T12:00:00Z',
}
const FOLDER_7 = {
  id: 7, parent_id: 3, name: '照片', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-05-05T00:00:00Z',
}

let filesBody: unknown = { items: [FILE_A, FILE_PDF], pagination: { page: 1, page_size: 20, total: 2 } }
let foldersBody: unknown = { items: [FOLDER_7] }
let impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = defaultImpl

function defaultImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'DELETE' && /^\/api\/v1\/files\/\d+$/.test(url)) return Promise.resolve(jsonResponse(204))
  if (url.startsWith('/api/v1/files/10/content')) {
    return Promise.resolve({
      ok: true, status: 200, headers: new Headers(),
      blob: async () => new Blob(['内容']),
    } as unknown as Response)
  }
  if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(200, filesBody))
  if (url.startsWith('/api/v1/folders')) return Promise.resolve(jsonResponse(200, foldersBody))
  return Promise.reject(new Error(`unexpected fetch: ${url}`))
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

async function selectRow(name: string) {
  await userEvent.click(screen.getByRole('checkbox', { name: `选择 ${name}` }))
}

describe('FilesPage 接线：checkbox selection → 右栏面板（abc-3/abc-4）', () => {
  beforeEach(() => {
    filesBody = { items: [FILE_A, FILE_PDF], pagination: { page: 1, page_size: 20, total: 2 } }
    foldersBody = { items: [FOLDER_7] }
    impl = defaultImpl
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    impl = defaultImpl
    cleanup()
    vi.unstubAllGlobals()
  })

  it('勾选单选 → aside 出现（元数据+所在目录复用 searchSourceLabel 模式）；RowToolbar 隐藏（abc-4 面板唯一载体）', async () => {
    renderPage()
    await screen.findByText('a.txt')
    expect(screen.queryByTestId('detail-panel')).toBeNull() // 无选中=单栏
    await selectRow('a.txt')

    const panel = await screen.findByTestId('detail-panel')
    expect(within(panel).getByTestId('panel-name')).toHaveTextContent('a.txt')
    expect(within(panel).getByTestId('panel-field-大小')).toHaveTextContent('1.5 KB')
    // 所在目录（浏览态）：冷缓存 folder_id=3 → 「目录 3」兜底（searchSourceLabel 同纪律，无 BFS）
    expect(within(panel).getByTestId('panel-field-所在目录')).toHaveTextContent('目录 3')
    for (const label of ['预览', '下载', '重命名', '移动', '问 AI']) {
      expect(within(panel).getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByTestId('row-toolbar')).toBeNull() // abc-4：单选浮条不再出现

    // 问 AI 门控：报告.pdf 非 TXT/MD → canAsk 拒（reason 同 qa-state 表），a.txt 合格 → 可用
    await selectRow('报告.pdf') // 先变多选，再取消 a.txt 回到 pdf 单选
    await selectRow('a.txt')
    const ask = within(screen.getByTestId('detail-panel')).getByRole('button', { name: '问 AI' })
    expect(ask).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(ask)
    expect(await screen.findByText('暂不支持问答，仅支持 TXT / Markdown 文件。')).toBeInTheDocument()
  })

  it('勾选文件夹行 → 预览/下载/问 AI 置灰带 reason；重命名/移动可用', async () => {
    renderPage()
    await screen.findByText('照片')
    await selectRow('照片')
    const panel = await screen.findByTestId('detail-panel')
    expect(within(panel).getByTestId('panel-field-大小')).toHaveTextContent('—')
    expect(within(panel).getByRole('button', { name: '预览' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(panel).getByRole('button', { name: '下载' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(panel).getByRole('button', { name: '问 AI' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(panel).getByRole('button', { name: '重命名' })).not.toHaveAttribute('aria-disabled')
    expect(within(panel).getByRole('button', { name: '移动' })).not.toHaveAttribute('aria-disabled')
  })

  it('多选 → 浮条与面板批量并存（abc-4）；面板「移入回收站」走既有确认弹窗→逐个 DELETE', async () => {
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await selectRow('报告.pdf')
    expect(await screen.findByTestId('row-toolbar')).toBeInTheDocument() // 多选浮条恢复
    const panel = await screen.findByTestId('detail-panel')
    expect(within(panel).getByTestId('panel-count')).toHaveTextContent('已选 2 项')
    await userEvent.click(within(panel).getByRole('button', { name: '移入回收站' }))
    expect(await screen.findByText('请确认操作')).toBeInTheDocument() // 确认渠道=对话框（非面板内联）
    expect(screen.getByText('将 2 个项目移入回收站？文件夹需为空才能删除。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u, init]) => String(u).endsWith('/api/v1/files/10') && (init as RequestInit)?.method === 'DELETE')).toBe(true)
      expect(fetchMock.mock.calls.some(([u, init]) => String(u).endsWith('/api/v1/files/11') && (init as RequestInit)?.method === 'DELETE')).toBe(true)
    })
  })

  it('关闭钮 → 清空勾选：面板消失且 checkbox 复位（clearSelectionToken 缝双向同步）', async () => {
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    const panel = await screen.findByTestId('detail-panel')
    await userEvent.click(within(panel).getByRole('button', { name: '关闭详情' }))
    await waitFor(() => expect(screen.queryByTestId('detail-panel')).toBeNull())
    expect(screen.getByRole('checkbox', { name: '选择 a.txt' })).not.toBeChecked()
  })

  it('单击行名仍走预览（不劫持选择，abc-3）：勾选面板在场时点另一行名 → 预览打开、勾选集合不变', async () => {
    // a.txt 勾选后面板在；单击「a.txt」文件名按钮仍预览（Task 7/10 语义不回归），面板仍 a.txt
    renderPage()
    await screen.findByText('a.txt')
    await selectRow('a.txt')
    await screen.findByTestId('detail-panel')
    await userEvent.click(screen.getByRole('button', { name: 'a.txt' }))
    expect(await screen.findByRole('dialog', { name: 'a.txt' })).toBeInTheDocument()
    expect(within(screen.getByTestId('detail-panel')).getByTestId('panel-name')).toHaveTextContent('a.txt')
  })
})
