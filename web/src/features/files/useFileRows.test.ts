// Task 7 数据层单测（RED-first）：mergeRows 纯函数四契约（顺序/文件夹前置、空态判定、
// 关键词模式忽略文件夹前置、字段格式化）+ useFileRows 三 query 合并（keys：
// ['files',f,p] / ['folders',f] / ['search',q,p]）、loading/empty/error 态、翻页重取。
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listFiles,
  listFolders,
  searchFiles,
  type FileItem,
  type FolderItem,
  type PageResult,
} from '@/api/storage'
import { mergeRows, PAGE_SIZE, useFileRows } from './useFileRows'

vi.mock('@/api/storage', () => ({
  listFiles: vi.fn(),
  listFolders: vi.fn(),
  searchFiles: vi.fn(),
}))

const mockedListFiles = vi.mocked(listFiles)
const mockedListFolders = vi.mocked(listFolders)
const mockedSearchFiles = vi.mocked(searchFiles)

function folder(id: number, name: string, parentId = 0): FolderItem {
  return { id, parent_id: parentId, name, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-02T00:00:00Z' }
}
function file(id: number, name: string, size: number, folderId = 0): FileItem {
  return {
    id, folder_id: folderId, original_name: name, size,
    content_type: 'text/plain', created_at: '2026-03-03T12:00:00Z',
  }
}
function pageResult<T>(items: T[], total = items.length, page = 1): PageResult<T> {
  return { items, pagination: { page, page_size: PAGE_SIZE, total } }
}

beforeEach(() => {
  mockedListFiles.mockReset()
  mockedListFolders.mockReset()
  mockedSearchFiles.mockReset()
})

describe('mergeRows：纯函数契约', () => {
  it('文件夹前置 + 组内保持服务端顺序', () => {
    const rows = mergeRows([folder(1, '项目'), folder(2, '图片')], [file(10, 'a.txt', 512), file(11, 'b.txt', 1024)], 2)
    expect(rows.map((r) => r.kind)).toEqual(['folder', 'folder', 'file', 'file'])
    expect(rows.map((r) => r.id)).toEqual([1, 2, 10, 11])
  })

  it('空态判定：total=0 且无残留数据 → 空数组；仅有文件夹（total 计文件数）不判空', () => {
    expect(mergeRows([], [], 0)).toEqual([])
    // total 来自 files 查询的 pagination，文件夹无独立 total：
    // 「目录里只有子文件夹」页面 total=0 但文件夹行必须保留，否则空目录误判。
    const rows = mergeRows([folder(1, '项目')], [], 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('folder')
  })

  it('关键词模式忽略文件夹前置：folders 传空数组时输出仅文件行', () => {
    const rows = mergeRows([], [file(10, '报告.pdf', 2048), file(11, '报表.xlsx', 4096)], 2)
    expect(rows.every((r) => r.kind === 'file')).toBe(true)
    expect(rows.map((r) => r.name)).toEqual(['报告.pdf', '报表.xlsx'])
  })

  it('类型标注与格式化：sizeText= formatBytes、dateText= formatDate（folder 用 updated_at）；folderId 上行（终评修波 3）', () => {
    const rows = mergeRows([folder(1, '项目')], [file(10, 'a.txt', 1536, 3)], 1)
    const f = rows[0]
    const a = rows[1]
    expect(f).toMatchObject({ kind: 'folder', name: '项目', sizeText: null, dateText: '2026-02-02' })
    expect(a).toMatchObject({ kind: 'file', name: 'a.txt', sizeText: '1.5 KB', dateText: '2026-03-03', contentType: 'text/plain', folderId: 3 })
  })
})

describe('useFileRows：三 query 合并', () => {
  function wrapperFactory() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children)
    }
  }

  it("浏览模式：['files',f,p]+['folders',f] 双查询合并，文件夹前置、total 透传", async () => {
    mockedListFolders.mockResolvedValue({ items: [folder(1, '项目', 3)] })
    mockedListFiles.mockResolvedValue(pageResult([file(10, 'a.txt', 512, 3)], 42))
    const { result } = renderHook(() => useFileRows(3, 1, null), { wrapper: wrapperFactory() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockedListFolders).toHaveBeenCalledWith(3)
    expect(mockedListFiles).toHaveBeenCalledWith(3, 1)
    expect(mockedSearchFiles).not.toHaveBeenCalled()
    expect(result.current.total).toBe(42)
    expect(result.current.rows.map((r) => r.kind)).toEqual(['folder', 'file'])
    expect(result.current.isEmpty).toBe(false)
    expect(result.current.keywordMode).toBe(false)
  })

  it('加载态：请求 pending 期间 isLoading=true，落定后 false', async () => {
    let resolveFiles!: (v: PageResult<FileItem>) => void
    mockedListFolders.mockResolvedValue({ items: [] })
    mockedListFiles.mockReturnValue(new Promise((r) => { resolveFiles = r }))
    const { result } = renderHook(() => useFileRows(3, 1, null), { wrapper: wrapperFactory() })
    expect(result.current.isLoading).toBe(true)
    resolveFiles(pageResult([], 0))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isEmpty).toBe(true)
  })

  it("搜索模式：['search',q,p] 单查询，不发 folders；空串关键词回落浏览", async () => {
    mockedSearchFiles.mockResolvedValue(pageResult([file(10, '报告.pdf', 2048)], 7))
    const { result } = renderHook(() => useFileRows(0, 2, '报告'), { wrapper: wrapperFactory() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockedSearchFiles).toHaveBeenCalledWith('报告', 2)
    expect(mockedListFolders).not.toHaveBeenCalled()
    expect(mockedListFiles).not.toHaveBeenCalled()
    expect(result.current.keywordMode).toBe(true)
    expect(result.current.total).toBe(7)
    expect(result.current.rows.every((r) => r.kind === 'file')).toBe(true)

    // 关键词空串/空白 → 回落浏览模式（TopBar 清除搜索后 URL q 消失的场景兜底）
    mockedListFolders.mockResolvedValue({ items: [] })
    mockedListFiles.mockResolvedValue(pageResult([], 0))
    const r2 = renderHook(() => useFileRows(3, 1, '  '), { wrapper: wrapperFactory() })
    await waitFor(() => expect(r2.result.current.isLoading).toBe(false))
    expect(r2.result.current.keywordMode).toBe(false)
    expect(mockedListFolders).toHaveBeenCalledWith(3)
  })

  it('翻页：page 变化 → 新查询键取数（服务端分页）', async () => {
    mockedListFolders.mockResolvedValue({ items: [] })
    mockedListFiles.mockResolvedValue(pageResult([file(10, 'a.txt', 1)], 25))
    const { result, rerender } = renderHook(({ p }: { p: number }) => useFileRows(3, p, null), {
      wrapper: wrapperFactory(),
      initialProps: { p: 1 },
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender({ p: 2 })
    await waitFor(() => expect(mockedListFiles).toHaveBeenCalledWith(3, 2))
    expect(result.current.pageSize).toBe(PAGE_SIZE)
  })

  it('rows 引用稳定：数据不变的重渲染返回同一引用（FilesTable 依此保勾选，Task 9/10 选择态前提）', async () => {
    mockedListFolders.mockResolvedValue({ items: [] })
    mockedListFiles.mockResolvedValue(pageResult([file(10, 'a.txt', 1)], 1))
    const { result, rerender } = renderHook(() => useFileRows(3, 1, null), { wrapper: wrapperFactory() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const before = result.current.rows
    rerender()
    rerender()
    expect(result.current.rows).toBe(before)
  })

  // 修复轮 1 / Minor ②（与 rows 同属引用稳定纪律）：items ?? [] 兜底同样不得每次 render 新引用。
  it('items 引用稳定：pending 兜底空数组与落定后均跨 render 同引用', async () => {
    let resolveFiles!: (v: PageResult<FileItem>) => void
    mockedListFolders.mockResolvedValue({ items: [] })
    mockedListFiles.mockReturnValue(new Promise((r) => { resolveFiles = r }))
    const { result, rerender } = renderHook(() => useFileRows(3, 1, null), { wrapper: wrapperFactory() })
    const pendingRef = result.current.items
    rerender()
    expect(result.current.items).toBe(pendingRef)
    resolveFiles(pageResult([file(10, 'a.txt', 1)], 1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const settledRef = result.current.items
    rerender()
    expect(result.current.items).toBe(settledRef)
  })

  it('错误态：list 查询失败 → isError + error 透传（调用方负责 Alert 展示）', async () => {
    mockedListFolders.mockResolvedValue({ items: [] })
    mockedListFiles.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFileRows(3, 1, null), { wrapper: wrapperFactory() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
  })
})
