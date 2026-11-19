// Task 6 crumbs 单测（Review Focus #3 钉死）：
// ① 缓存命中走 fast-path（不发请求）；② 冷启动逐层 BFS 得到正确祖先链 0→1→3→9；
// ③ 某层接口失败 → 降级单元素 `[{ id, name: '' }]`，由调用方（Task 7 文件列表）从当前列表数据补名。
// 另钉 setTrail 契约：写目标条目 + 全部祖先前缀子链（Task 7 导航成功后调用）。
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listFolders, type FolderItem } from '@/api/storage'
import {
  navTrailKey,
  resolveAncestorPath,
  setTrail,
  ROOT_FOLDER_ID,
  type Crumb,
} from './crumbs'

vi.mock('@/api/storage', () => ({
  listFolders: vi.fn(),
}))

const mockedListFolders = vi.mocked(listFolders)

// 目录树：0(根) → [1 '项目', 2 '图片']；1 → [3 '文档', 4 '杂项']；3 → [9 '深度']
const TREE: Record<number, FolderItem[]> = {
  [ROOT_FOLDER_ID]: [folder(1, '项目'), folder(2, '图片')],
  1: [folder(3, '文档'), folder(4, '杂项')],
  3: [folder(9, '深度')],
  2: [],
  4: [],
  9: [],
}

function folder(id: number, name: string) {
  return { id, parent_id: 0, name, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
}

function mockTree() {
  mockedListFolders.mockImplementation(async (parentId: number) => ({
    items: TREE[parentId] ?? [],
  }))
}

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockedListFolders.mockReset()
  mockTree()
})

describe('resolveAncestorPath：缓存 fast-path', () => {
  it('根目录直接返回单根 crumb，不发任何请求', async () => {
    const trail = await resolveAncestorPath(ROOT_FOLDER_ID, queryClient)
    expect(trail).toEqual([{ id: ROOT_FOLDER_ID, name: '根目录' }])
    expect(mockedListFolders).not.toHaveBeenCalled()
  })

  it('setTrail 写入后命中缓存：不触发 listFolders', async () => {
    const full: Crumb[] = [
      { id: 0, name: '根目录' },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
      { id: 9, name: '深度' },
    ]
    setTrail(queryClient, 9, full)
    mockedListFolders.mockRejectedValue(new Error('fast-path 不应发请求'))

    await expect(resolveAncestorPath(9, queryClient)).resolves.toEqual(full)
    expect(mockedListFolders).not.toHaveBeenCalled()
  })

  it('setTrail 同时回填祖先前缀链：访问祖先目录也命中缓存', async () => {
    setTrail(queryClient, 9, [
      { id: 0, name: '根目录' },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
      { id: 9, name: '深度' },
    ])
    mockedListFolders.mockRejectedValue(new Error('前缀链也应命中缓存'))

    await expect(resolveAncestorPath(3, queryClient)).resolves.toEqual([
      { id: 0, name: '根目录' },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
    ])
    expect(mockedListFolders).not.toHaveBeenCalled()
  })

  it('损坏缓存（尾项与目标不符）不采信：回落 BFS', async () => {
    queryClient.setQueryData(navTrailKey(9), [{ id: 0, name: '根目录' }, { id: 8, name: '错链' }])
    const trail = await resolveAncestorPath(9, queryClient)
    expect(trail.map((c) => c.id)).toEqual([0, 1, 3, 9])
  })
})

describe('resolveAncestorPath：冷启动逐层 BFS（0→1→3→9 正确链）', () => {
  it('返回完整祖先链且只展开必要层级', async () => {
    const trail = await resolveAncestorPath(9, queryClient)
    expect(trail).toEqual([
      { id: 0, name: '根目录' },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
      { id: 9, name: '深度' },
    ])
    // 广度优先逐层展开：0 →(1,2)→ 1 → 2 → 3；命中 9 即返回，不再展开 4/9，也不调用 9 层
    expect(mockedListFolders.mock.calls.map(([p]) => p)).toEqual([0, 1, 2, 3])
  })

  it("BFS 成功后写入 navTrail 缓存（二次解析零请求）并预热 ['folders'] 列表缓存", async () => {
    await resolveAncestorPath(9, queryClient)
    expect(queryClient.getQueryData(navTrailKey(9))).toEqual([
      { id: 0, name: '根目录' },
      { id: 1, name: '项目' },
      { id: 3, name: '文档' },
      { id: 9, name: '深度' },
    ])
    expect(queryClient.getQueryData(['folders', 1])).toBeDefined() // Task 7 列表同 key 复用

    const callsAfterFirst = mockedListFolders.mock.calls.length
    await resolveAncestorPath(9, queryClient)
    expect(mockedListFolders).toHaveBeenCalledTimes(callsAfterFirst)
  })
})

describe('resolveAncestorPath：失败降级（Review Focus #3）', () => {
  it('中间层 listFolders reject → 单元素降级 + name 空串（调用方从列表数据补名）', async () => {
    mockedListFolders.mockImplementation(async (parentId: number) => {
      if (parentId === 1) throw new Error('network down')
      return { items: TREE[parentId] ?? [] }
    })

    const trail = await resolveAncestorPath(9, queryClient)
    expect(trail).toEqual([{ id: 9, name: '' }])
    // 降级结果不写 navTrail 缓存：下次解析仍会重试 BFS
    expect(queryClient.getQueryData(navTrailKey(9))).toBeUndefined()
  })

  it('目标不可达（遍历穷尽）→ 同样单元素降级，不抛错', async () => {
    const trail = await resolveAncestorPath(999, queryClient)
    expect(trail).toEqual([{ id: 999, name: '' }])
  })

  it('useQuery 写回的降级链（name 空串）不采信：再次调用重试 BFS 自愈（修复轮 1 / Finding #1）', async () => {
    // 模拟 TopBar 侧 useQuery 把 resolveAncestorPath 的降级结果持久化进同键缓存的场景；
    // 合同语义：降级只作为返回值存在，不作为可命中的缓存态。
    queryClient.setQueryData(navTrailKey(9), [{ id: 9, name: '' }])
    const trail = await resolveAncestorPath(9, queryClient)
    expect(mockedListFolders).toHaveBeenCalled() // 未走 fast-path
    expect(trail.map((c) => c.id)).toEqual([0, 1, 3, 9])
  })

  it('补名契约：降级 crumb 交给 setTrail 补名后可直接命中缓存', async () => {
    mockedListFolders.mockRejectedValue(new Error('offline'))
    const degraded = await resolveAncestorPath(9, queryClient)
    expect(degraded).toEqual([{ id: 9, name: '' }])

    // 模拟 Task 7：从当前列表数据（父目录 children 已含 id=9 的 name）补名后写回
    const filled: Crumb[] = [{ id: 0, name: '根目录' }, { id: 1, name: '项目' }, { id: 3, name: '文档' }, { id: 9, name: '深度' }]
    setTrail(queryClient, 9, filled)
    await expect(resolveAncestorPath(9, queryClient)).resolves.toEqual(filled)
  })
})
