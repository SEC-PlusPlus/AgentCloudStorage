// 文件列表表格（Task 7 / spec §5.2）：vendored table 原语 + 外部 Pagination（服务端分页，
// 后端无排序参数，不用 data-table 自取数）。交互全部走「回调缝」：
//   onContext/onSelectionChange 由 Task 9 接实；onPreview 由 Task 10 接实（FilesPage 预览 sheet）。
//   Task 10 评审强制项⑭（键盘入口）：文件名与文件夹名同构为行内按钮——文件夹=单击进入（Task 7），
//   文件=单击/聚焦后 Enter/Space 预览；行双击缝保留不回归。按钮原生 keyboard 语义，无需自造 keydown。
//   onFolderOpen 由 FilesPage 拥有（URL ?folder= 更新 + navTrail 追加，见 crumbs 契约）。
import { useEffect, useMemo, useRef, useState } from 'react'
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
  /** 双击文件行，或单击/Enter 聚焦的文件名按钮（Task 10 预览接线）。 */
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
  const selectedRef = useRef(selected)
  selectedRef.current = selected // 渲染期镜像：effects 读最新勾选而不必把 selected 拉进依赖（避免自触发）

  // 翻页/切目录/换搜索词都会带来新 rows 引用：清勾选，防止陈旧选择跨页泄漏给 Task 9/10 批量操作。
  // 修复轮 1 / Important #3：若清空前存在勾选，必须经 onSelectionChange([]) 上抛——
  // 只清内部 Set 会让上游接线方（浮动操作条等）继续持有陈旧集合。rows 引用未变时不重跑、不空报。
  const prevRowsRef = useRef(rows)
  useEffect(() => {
    if (prevRowsRef.current === rows) return
    prevRowsRef.current = rows
    const hadSelection = selectedRef.current.size > 0
    if (hadSelection) {
      setSelected(new Set())
      onSelectionChange([])
    }
  }, [rows, onSelectionChange])

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
                // T13 carry #19（Task 10 Minor-6）：focus-visible ring 补齐——与文件名按钮（⑭）对称，
                // 键盘 Tab 到文件夹行时焦点可见（旧缺一环属不对称疏漏，非行为差异）。
                <button
                  type="button"
                  onClick={() => onFolderOpen(row)}
                  className="inline-flex max-w-full items-center gap-2 text-left text-[var(--color-foreground)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                >
                  <Folder size={16} className="shrink-0 opacity-80" />
                  <span className="truncate">{row.name}</span>
                </button>
              ) : (
                // ⑭ 键盘入口：与文件夹名按钮同构（Enter/Space 原生触发=预览；focus-visible 环可见）
                <button
                  type="button"
                  onClick={() => onPreview(row)}
                  className="inline-flex max-w-full items-center gap-2 text-left text-[var(--color-foreground)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                >
                  <FileText size={16} className="shrink-0 opacity-60" />
                  <span className="truncate">{row.name}</span>
                </button>
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
