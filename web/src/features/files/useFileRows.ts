// 文件列表数据层（Task 7 / spec §5.2）：浏览 = ['folders',f]+['files',f,p] 双 query 合并；
// 搜索 = ['search',q,p] 单 query（服务端分页，每页 20，无排序参数——故表格是纯展示原语而非 data-table）。
// FileRow 为 Task 9/10/12 复用的行契约：类型标注 + formatBytes/formatDate 已格式化。
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listFiles, listFolders, searchFiles, type FileItem, type FolderItem } from '@/api/storage'
import { formatBytes, formatDate } from '@/lib/format'

/** 服务端分页大小（api/storage.ts 三处 page_size=20 的前端镜像）。 */
export const PAGE_SIZE = 20

/** 列表行：文件夹前置；sizeText 对文件夹恒 null（显示「—」）。 */
export type FileRow =
  | { kind: 'folder'; id: number; name: string; sizeText: null; dateText: string }
  | { kind: 'file'; id: number; name: string; sizeText: string; dateText: string; contentType: string }

/**
 * 纯合并函数（brief Step 1 钉死）：
 * ① 文件夹前置、组内保持服务端顺序；② 类型标注与字节/日期格式化；
 * ③ total 来自 files 查询的 pagination，只计文件数——「目录里只有子文件夹」时 total=0
 * 文件夹行仍须保留，故空判定要求三者同时为空；④ 搜索模式调用方传 folders=[]，
 * 天然忽略文件夹前置（行集恒 files-only）。
 */
export function mergeRows(folders: FolderItem[], files: FileItem[], total: number): FileRow[] {
  if (total === 0 && folders.length === 0 && files.length === 0) return []
  const folderRows: FileRow[] = folders.map((item) => ({
    kind: 'folder',
    id: item.id,
    name: item.name,
    sizeText: null,
    dateText: formatDate(item.updated_at),
  }))
  const fileRows: FileRow[] = files.map((item) => ({
    kind: 'file',
    id: item.id,
    name: item.original_name,
    sizeText: formatBytes(item.size),
    dateText: formatDate(item.created_at),
    contentType: item.content_type,
  }))
  return [...folderRows, ...fileRows]
}

export interface FileRowsState {
  rows: FileRow[]
  /** 服务端返回的当前页原始文件条目（Task 10 预览/下载接线时按 id 回查即可，此处透传省一次缓存读）。 */
  items: FileItem[]
  total: number
  pageSize: number
  keywordMode: boolean
  isLoading: boolean
  isError: boolean
  error: unknown
  isEmpty: boolean
}

/**
 * folderId=0 为根；keyword=null/空白回落浏览模式。
 * 搜索模式不发 folders 查询（enabled:false，isPending 恒真需手动豁免）。
 */
export function useFileRows(folderId: number, page: number, keyword: string | null): FileRowsState {
  const kw = keyword?.trim() ?? ''
  const keywordMode = kw !== ''

  const listQuery = useQuery({
    queryKey: keywordMode ? (['search', kw, page] as const) : (['files', folderId, page] as const),
    queryFn: () => (keywordMode ? searchFiles(kw, page) : listFiles(folderId, page)),
  })
  const foldersQuery = useQuery({
    queryKey: ['folders', folderId] as const,
    queryFn: () => listFolders(folderId),
    enabled: !keywordMode,
  })

  const listResult = listQuery.data
  const foldersData = foldersQuery.data

  // 依赖只放稳定引用（query data 对象）；勿用 ?? [] 内联兜底——那会让 rows 每次 render 新引用，
  // FilesTable 的「rows 变化清勾选」effect 会被误触发，勾选态在重渲染时闪丢。
  const rows = useMemo(
    () => mergeRows(keywordMode ? [] : (foldersData?.items ?? []), listResult?.items ?? [], listResult?.pagination.total ?? 0),
    [keywordMode, foldersData, listResult],
  )

  const isLoading = listQuery.isPending || (!keywordMode && foldersQuery.isPending)
  const isError = listQuery.isError || (!keywordMode && foldersQuery.isError)

  return {
    rows,
    items: listResult?.items ?? [],
    total: listResult?.pagination.total ?? 0,
    pageSize: listResult?.pagination.page_size ?? PAGE_SIZE,
    keywordMode,
    isLoading,
    isError,
    error: listQuery.error ?? foldersQuery.error,
    isEmpty: !isLoading && !isError && rows.length === 0,
  }
}
