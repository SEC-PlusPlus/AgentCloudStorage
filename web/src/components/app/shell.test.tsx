// Task 6 外壳行为锚：TopBar（品牌/面包屑/用量条）与 Dock（导航、noop 动作、用户菜单）。
// 渲染路径自组 Provider（QueryClient 可在用例前 setTrail 预热，模拟 Task 7 导航后缓存契约）。
import type { ReactNode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStorageUsage, listFolders, type FolderItem } from '@/api/storage'
import { Dock } from '@/components/app/Dock'
import { TopBar } from '@/components/app/TopBar'
import { ROOT_LABEL, navTrailKey, setTrail } from '@/features/files/crumbs'
import { ThemeProvider } from '@/providers/theme'
import { authActions, useAuth } from '@/stores/auth'

vi.mock('@/api/storage', () => ({
  getStorageUsage: vi.fn(),
  listFolders: vi.fn(),
}))

const mockedUsage = vi.mocked(getStorageUsage)
const mockedFolders = vi.mocked(listFolders)

function folderItem(id: number, parentId: number, name: string): FolderItem {
  return { id, parent_id: parentId, name, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
}

// 服务恢复后的目录树 0→1→3→9（BFS 自愈用例用）
const RECOVERY_TREE: Record<number, FolderItem[]> = {
  0: [folderItem(1, 0, '项目')],
  1: [folderItem(3, 1, '文档')],
  3: [folderItem(9, 3, '深度')],
}

function LocationProbe() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

function renderWithProviders(ui: ReactNode, { entry = '/files', queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }) } = {}) {
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[entry]}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

function loginSession(): void {
  authActions.setSession('tok', new Date(Date.now() + 3_600_000).toISOString(), {
    id: 1,
    username: 'tester',
    email: 'tester@example.com',
    created_at: '2026-01-01T00:00:00Z',
  })
}

beforeEach(() => {
  mockedUsage.mockReset()
  mockedFolders.mockReset()
  mockedUsage.mockResolvedValue({ used_bytes: 1024, quota_bytes: 4096 })
  mockedFolders.mockResolvedValue({ items: [] })
  loginSession()
})

afterEach(() => {
  cleanup()
  authActions.clear()
  localStorage.removeItem('acs.theme')
})

describe('TopBar：品牌 + 面包屑 + 用量条', () => {
  it('渲染 BrandMark（应用名）与根面包屑；用量条显 formatBytes 与百分比', async () => {
    renderWithProviders(<TopBar />)
    expect(await screen.findByText('Agent 云仓')).toBeInTheDocument()
    expect(screen.getByText('根目录')).toBeInTheDocument()
    expect(await screen.findByText('1.0 KB / 4.0 KB')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25'),
    )
  })

  it('深链 ?folder=3 且 navTrail 已缓存（Task 7 契约）：面包屑显完整链，末项 aria-current', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    setTrail(queryClient, 3, [
      { id: 0, name: '根目录' },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
    ])
    renderWithProviders(<TopBar />, { entry: '/files?folder=3', queryClient })
    expect(mockedFolders).not.toHaveBeenCalled() // 缓存链直用，不发 BFS
    const current = await screen.findByText('文档')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('项目')).toBeInTheDocument()
  })

  it('点击祖先面包屑跳转对应 ?folder=；末项不可点', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    setTrail(queryClient, 3, [
      { id: 0, name: '根目录' },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
    ])
    renderWithProviders(<TopBar />, { entry: '/files?folder=3', queryClient })
    await userEvent.click(await screen.findByRole('button', { name: '项目' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/files?folder=1')
    expect(screen.queryByRole('button', { name: '文档' })).toBeNull()
  })

  it('非 files 路由（/trash）面包屑回落单根', async () => {
    renderWithProviders(<TopBar />, { entry: '/trash' })
    expect((await screen.findByTestId('breadcrumb')).textContent).toContain('根目录')
    expect(mockedFolders).not.toHaveBeenCalled()
  })

  it('缓存中的降级链（useQuery 写回形态）不再冒充 fast-path：恢复后重试 BFS 自愈（修复轮 1 / Finding #1）', async () => {
    mockedFolders.mockRejectedValue(new Error('offline'))
    const queryClient = renderWithProviders(<TopBar />, { entry: '/files?folder=9' })
    expect(await screen.findByText('目录 9')).toBeInTheDocument() // 降级态：占位名显示
    expect(queryClient.getQueryData(navTrailKey(9))).toEqual([{ id: 9, name: '' }]) // useQuery 确已写回同键

    mockedFolders.mockImplementation(async (parentId: number) => ({ items: RECOVERY_TREE[parentId] ?? [] }))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: navTrailKey(9) }) // 触发重跑 queryFn（同重挂载/聚焦路径）
    })
    expect(await screen.findByText('深度')).toBeInTheDocument()
    expect(queryClient.getQueryData(navTrailKey(9))).toEqual([
      { id: 0, name: ROOT_LABEL },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
      { id: 9, name: '深度' },
    ])
  })
})

describe('Dock：导航 / noop 动作 / 用户菜单', () => {
  it('渲染全部条目；默认 noop 时点击上传/搜索/新建不报错', async () => {
    renderWithProviders(<Dock />)
    for (const label of ['全部文件', '回收站', '搜索', '上传', '新建文件夹', '用户菜单']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: '上传' }))
    await userEvent.click(screen.getByRole('button', { name: '搜索' }))
    await userEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
  })

  it('注入 actions 后上传/搜索/新建各自回调一次', async () => {
    const actions = { onUpload: vi.fn(), onSearch: vi.fn(), onNewFolder: vi.fn() }
    renderWithProviders(<Dock actions={actions} />)
    await userEvent.click(screen.getByRole('button', { name: '上传' }))
    await userEvent.click(screen.getByRole('button', { name: '搜索' }))
    await userEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    expect(actions.onUpload).toHaveBeenCalledTimes(1)
    expect(actions.onSearch).toHaveBeenCalledTimes(1)
    expect(actions.onNewFolder).toHaveBeenCalledTimes(1)
  })

  it('全部文件→/files、回收站→/trash', async () => {
    renderWithProviders(<Dock />, { entry: '/files?folder=3' })
    await userEvent.click(screen.getByRole('button', { name: '回收站' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/trash')
    await userEvent.click(screen.getByRole('button', { name: '全部文件' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/files')
  })

  it('用户菜单：主题切换持久化；退出登录清会话并跳 /login', async () => {
    renderWithProviders(<Dock />)
    await userEvent.click(screen.getByRole('button', { name: '用户菜单' }))

    await userEvent.click(await screen.findByRole('menuitem', { name: /切换主题/ }))
    expect(localStorage.getItem('acs.theme')).toBe('light') // 默认暗色 → 切亮色并落存储

    await userEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }))
    await waitFor(() => expect(useAuth.getState().token).toBe(''))
    expect(sessionStorage.getItem('acs.access-token')).toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent('/login')
  })
})

// Task 7 搜索入口（裁定：TopBar 输入框 → URL ?q=，命令面板留 Task 13）：提交写 q、目录上下文清空、
// URL→输入框反向同步（前进/后退一致）、空提交退出搜索态。
describe('TopBar：搜索入口（?q= 驱动）', () => {
  it('输入关键词回车 → /files?q=…（中文编码、folder 不携带）', async () => {
    renderWithProviders(<TopBar />, { entry: '/files?folder=3' })
    const box = await screen.findByRole('searchbox', { name: '搜索文件' })
    await userEvent.type(box, '报告 1')
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/files?q=${encodeURIComponent('报告 1')}`),
    )
  })

  it('深链 ?q= 回填输入框；清空后回车退出搜索态', async () => {
    renderWithProviders(<TopBar />, { entry: `/files?q=${encodeURIComponent('旧词')}` })
    const box = await screen.findByRole('searchbox', { name: '搜索文件' })
    expect(box).toHaveValue('旧词')
    await userEvent.clear(box)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/files'))
  })
})
