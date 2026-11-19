// 文件列表表格（Task 7 / spec §5.2）：vendored table 原语 + 外部 Pagination（服务端分页，
// 后端无排序参数，不用 data-table 自取数）。交互全部走「回调缝」：
//   onPreview/onContext/onSelectionChange 为 Task 9/10 接线点（本任务默认 no-op，行为不回归）；
//   onFolderOpen 由 FilesPage 拥有（URL ?folder= 更新 + navTrail 追加，见 crumbs 契约）。
import { useEffect, useMemo, useState } from 'react'
import { FileText, Folder } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/glinui/components/table'
import { Checkbox } from '@/components/glinui/components/checkbox'
import { Skeleton } from '@/components/glinui/components/skeleton'
import type { FileRow } from './useFileRows'

const noop = () => undefined

export interface FilesTableProps {
  rows: FileRow[]
  loading?: boolean
  /** 双击文件行（Task 10 预览接线）。 */
  onPreview?: (row: FileRow) => void
  /** 右键行（Task 9 上下文菜单接线；pos 为视口坐标）。 */
  onContext?: (row: FileRow, pos: { x: number; y: number }) => void
  /** 勾选集合变化上抛（Task 9/10 批量操作接线）。 */
  onSelectionChange?: (rows: FileRow[]) => void
  /** 单击文件夹行（FilesPage 注入：导航 + setTrail）。 */
  onFolderOpen?: (row: FileRow) => void
}

/** 行唯一键：folder/file 各自 id 独立序列（后端两表），需 kind 前缀防碰撞。 */
export const rowKey = (row: FileRow): string => `${row.kind}:${row.id}`

const LOADING_ROWS = 5

export function FilesTable({
  rows,
  loading = false,
  onPreview = noop,
  onContext = noop,
  onSelectionChange = noop,
  onFolderOpen = noop,
}: FilesTableProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  // 翻页/切目录/换搜索词都会带来新 rows 引用：清勾选，防止陈旧选择跨页泄漏给 Task 9/10 批量操作。
  useEffect(() => {
    setSelected(new Set())
  }, [rows])

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(rowKey(row))), [rows, selected])
  const allChecked = rows.length > 0 && selectedRows.length === rows.length

  const commit = (next: Set<string>) => {
    setSelected(next)
    onSelectionChange(rows.filter((row) => next.has(rowKey(row))))
  }

  const toggleRow = (row: FileRow, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(rowKey(row))
    else next.delete(rowKey(row))
    commit(next)
  }

  const toggleAll = (checked: boolean) => {
    const next = new Set(selected)
    for (const row of rows) {
      if (checked) next.add(rowKey(row))
      else next.delete(rowKey(row))
    }
    commit(next)
  }

  if (loading) {
    return (
      <div aria-busy="true" data-testid="files-loading">
        <Table variant="glass" rowDividers>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>名称</TableHead>
              <TableHead align="right" className="w-28">大小</TableHead>
              <TableHead className="w-32">修改时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: LOADING_ROWS }, (_, index) => (
              <TableRow key={index} aria-hidden="true">
                <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                <TableCell><Skeleton className="h-4 w-2/3" /></TableCell>
                <TableCell><Skeleton className="h-4 w-12 justify-self-end" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <Table variant="glass" interactive rowDividers stickyHeader containerClassName="overflow-x-auto">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              size="sm"
              aria-label="全选本页"
              checked={allChecked ? true : selectedRows.length > 0 ? 'indeterminate' : false}
              onCheckedChange={(value) => toggleAll(value === true)}
            />
          </TableHead>
          <TableHead>名称</TableHead>
          <TableHead align="right" className="w-28">大小</TableHead>
          <TableHead className="w-32">修改时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={rowKey(row)}
            data-testid={`row-${rowKey(row)}`}
            onDoubleClick={() => (row.kind === 'file' ? onPreview(row) : onFolderOpen(row))}
            onContextMenu={(event) => {
              event.preventDefault() // 屏蔽原生菜单（Task 9 换自绘上下文菜单）
              onContext(row, { x: event.clientX, y: event.clientY })
            }}
          >
            <TableCell>
              <Checkbox
                size="sm"
                aria-label={`选择 ${row.name}`}
                checked={selected.has(rowKey(row))}
                onCheckedChange={(value) => toggleRow(row, value === true)}
              />
            </TableCell>
            <TableCell truncate>
              {row.kind === 'folder' ? (
                <button
                  type="button"
                  onClick={() => onFolderOpen(row)}
                  className="inline-flex max-w-full items-center gap-2 text-left text-[var(--color-foreground)] underline-offset-4 hover:underline"
                >
                  <Folder size={16} className="shrink-0 opacity-80" />
                  <span className="truncate">{row.name}</span>
                </button>
              ) : (
                <span className="inline-flex max-w-full items-center gap-2">
                  <FileText size={16} className="shrink-0 opacity-60" />
                  <span className="truncate">{row.name}</span>
                </span>
              )}
            </TableCell>
            <TableCell align="right" className="tabular-nums opacity-80">
              {row.sizeText ?? '—'}
            </TableCell>
            <TableCell className="opacity-80">{row.dateText}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
