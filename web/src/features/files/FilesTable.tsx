// 文件列表表格（Task 7 / spec §5.2）：vendored table 原语 + 外部 Pagination（服务端分页，
// 后端无排序参数，不用 data-table 自取数）。交互全部走「回调缝」：
//   onContext/onSelectionChange 由 Task 9 接实；onPreview 由 Task 10 接实（FilesPage 预览 sheet）。
//   Task 10 评审强制项⑭（键盘入口）：文件名与文件夹名同构为行内按钮——文件夹=单击进入（Task 7），
//   文件=单击/聚焦后 Enter/Space 预览；行双击缝保留不回归。按钮原生 keyboard 语义，无需自造 keydown。
//   onFolderOpen 由 FilesPage 拥有（URL ?folder= 更新 + navTrail 追加，见 crumbs 契约）。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import {
  FILE_ICON_TONE_CLASS,
  FOLDER_ICON,
  FOLDER_TONE_CLASS,
  classifyFileIcon,
  fileIcon,
} from '@/lib/file-icons'
import { ROOT_FOLDER_ID, ROOT_LABEL, isUsableTrail } from './crumbs'
import type { FileRow } from './useFileRows'

const noop = () => undefined

/**
 * 搜索行源目录副标题（终评修波 3，旧 adbcfba FileWorkbench:595「目录 ID · folder_id」承继）：
 * 纯函数、TrashPage.sourceFolderLabel 同纪律——只读传入的 `['navTrail']` 缓存快照
 * （isUsableTrail 同源谓词，拒降级空名链），命中取尾项名，**绝不触发 BFS**；
 * 未命中 `目录 <id>`；根目录（folder_id=0）直给「根目录」（旧 `folder_id || '根目录'` 对齐，
 * 同 TopBar 避闪「目录 0」）。缓存快照由 FilesPage 渲染期 getQueryData 后经 label 函数注入
 * （本组件保持无 Provider 可独立渲染）。
 */
export function searchSourceLabel(cached: unknown, folderId: number): string {
  if (isUsableTrail(cached, folderId)) return cached[cached.length - 1]?.name ?? ''
  return folderId === ROOT_FOLDER_ID ? ROOT_LABEL : `目录 ${folderId}`
}

export interface FilesTableProps {
  rows: FileRow[]
  loading?: boolean
  /**
   * 搜索态行名下的源目录副标题（终评修波 3；FilesPage 仅 keywordMode 注入，缺省=不渲染、浏览态零变化）。
   * 入参 FileRow.folderId，返回展示文案（cache-hit 链尾名 / `目录 <id>` / 根=「根目录」）。
   */
  searchSourceLabel?: (folderId: number) => string
  /** 双击文件行，或单击/Enter 聚焦的文件名按钮（Task 10 预览接线）。 */
  onPreview?: (row: FileRow) => void
  /** 右键行（Task 9 上下文菜单接线；pos 为视口坐标）。 */
  onContext?: (row: FileRow, pos: { x: number; y: number }) => void
  /** 勾选集合变化上抛（Task 9/10 批量操作接线）。 */
  onSelectionChange?: (rows: FileRow[]) => void
  /** 单击文件夹行（FilesPage 注入：导航 + setTrail）。 */
  onFolderOpen?: (row: FileRow) => void
  /**
   * Task 2-B 面板关闭钮的外部清选信号（值变化 → 内部清勾选集）。**不回抛 onSelectionChange**：
   * 发起方（FilesPage）已自清 selection 镜像，回抛只会形成环；rows 换引用清选路径仍照常上抛
   * （Important #3 契约不回归）。
   */
  clearSelectionToken?: number
}

/** 行唯一键：folder/file 各自 id 独立序列（后端两表），需 kind 前缀防碰撞。 */
export const rowKey = (row: FileRow): string => `${row.kind}:${row.id}`

const LOADING_ROWS = 5

/**
 * 列表内滚高度扣减（Task 1-A，唯一数源；TrashPage 共享本常量）——`100vh − 272px` 的 272 构成：
 *   TopBar（vendored glass-navbar md `min-h-14`）          ≈ 56
 *   AppLayout main 上内边距（p-4）                          = 16
 *   页头行（h1/工具条，Button sm h-8 取高）                 ≈ 32
 *   页头 ↔ 列表 gap（flex-col gap-3）                      = 12
 *   分页条行（Pagination 按钮 h-8）+ 其上 gap-3            ≈ 44
 *   main 底部 dock 预留带（pb-28，dock fixed 悬浮区）       = 112
 *   合计                                                    272
 * 各「≈」项为静态组件的确定档位，浏览器矩阵 A-C11.2 目测校正。
 */
export const LIST_SCROLL_OFFSET_PX = 272
/**
 * 内滚容器类（单一字面量——Tailwind v4 扫描器不识别运行时拼接的 arbitrary 值，
 * 变量名与 listScrollFrameStyle 的自定义属性成对，改一处须同步两处）。
 */
export const LIST_SCROLL_CONTAINER_CLASS = 'max-h-[var(--file-list-max-h)] overflow-x-auto overflow-y-auto'
/** 挂在列表外层（display:contents 不引入布局盒），把常量注成 CSS 变量喂给上面的类。 */
export const listScrollFrameStyle = {
  '--file-list-max-h': `calc(100vh - ${LIST_SCROLL_OFFSET_PX}px)`,
} as CSSProperties

export function FilesTable({
  rows,
  loading = false,
  searchSourceLabel,
  onPreview = noop,
  onContext = noop,
  onSelectionChange = noop,
  onFolderOpen = noop,
  clearSelectionToken = 0,
}: FilesTableProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const selectedRef = useRef(selected)
  selectedRef.current = selected // 渲染期镜像：effects 读最新勾选而不必把 selected 拉进依赖（避免自触发）

  // Task 2-B：详情面板关闭钮 → 页面递增 token → 此处清内部勾选集（双向同步，checkbox 不滞留勾选态）。
  // token 初值随首渲锚定，挂载后仅「值变化」才清；不通知 onSelectionChange（理由见 props 注）。
  const clearTokenRef = useRef(clearSelectionToken)
  useEffect(() => {
    if (clearTokenRef.current === clearSelectionToken) return
    clearTokenRef.current = clearSelectionToken
    setSelected(new Set())
  }, [clearSelectionToken])

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
        {/* 列骨架与数据态同构（含图标列/吸顶/内滚容器类）——loading→loaded 零列宽跳动 */}
        <div className="contents" style={listScrollFrameStyle}>
          <Table variant="glass" rowDividers stickyHeader containerClassName={LIST_SCROLL_CONTAINER_CLASS}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead className="w-10" aria-label="类型" />
                <TableHead>名称</TableHead>
                <TableHead align="right" className="w-28">大小</TableHead>
                <TableHead className="w-32">修改时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: LOADING_ROWS }, (_, index) => (
                <TableRow key={index} aria-hidden="true">
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-6" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-2/3" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 justify-self-end" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  return (
    <div className="contents" style={listScrollFrameStyle}>
      <Table variant="glass" interactive rowDividers stickyHeader containerClassName={LIST_SCROLL_CONTAINER_CLASS}>
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
            <TableHead className="w-10" aria-label="类型" />
            <TableHead>名称</TableHead>
            <TableHead align="right" className="w-28">大小</TableHead>
            <TableHead className="w-32">修改时间</TableHead>
          </TableRow>
        </TableHeader>
      <TableBody>
        {rows.map((row) => {
          // 行首类型图标（Task 1-A）：kind 判别在调用侧，文件族走 file-icons 双判；
          // icon-frame 缺位 → span 自绘托底（裁定注释见 FILE_ICON_TONE_CLASS 头注，lib/file-icons.ts）。
          const Icon = row.kind === 'folder' ? FOLDER_ICON : fileIcon(row.name, row.contentType)
          const tone =
            row.kind === 'folder'
              ? FOLDER_TONE_CLASS
              : FILE_ICON_TONE_CLASS[classifyFileIcon(row.name, row.contentType)]
          return (
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
              {/* 图标列收紧横向 padding（cn=tailwind-merge 后到覆盖 p-3 的 x 轴） */}
              <TableCell className="px-2">
                <span
                  aria-hidden="true"
                  data-testid={`row-icon-${rowKey(row)}`}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-surface)]/60 ${tone}`}
                >
                  <Icon size={16} className="shrink-0" />
                </span>
              </TableCell>
              <TableCell truncate>
                {row.kind === 'folder' ? (
                  // T13 carry #19（Task 10 Minor-6）：focus-visible ring 补齐——与文件名按钮（⑭）对称，
                  // 键盘 Tab 到文件夹行时焦点可见（旧缺一环属不对称疏漏，非行为差异）。
                  // Task 1-A：行内图标上移至图标列，按钮仅剩文本（可访问名不变，锚点测试零改写）。
                  <button
                    type="button"
                    onClick={() => onFolderOpen(row)}
                    className="inline-flex max-w-full text-left text-[var(--color-foreground)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                  >
                    <span className="truncate">{row.name}</span>
                  </button>
                ) : (
                  // ⑭ 键盘入口：与文件夹名按钮同构（Enter/Space 原生触发=预览；focus-visible 环可见）。
                  // 终评修波 3：搜索态（searchSourceLabel 在场）名下追加源目录副标题；
                  // 按钮 self-start 保持内容宽——聚焦环/悬停下划线范围与浏览态逐像素同构。
                  <span className="flex min-w-0 flex-col leading-tight">
                    <button
                      type="button"
                      onClick={() => onPreview(row)}
                      className="inline-flex max-w-full self-start text-left text-[var(--color-foreground)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                    >
                      <span className="truncate">{row.name}</span>
                    </button>
                    {searchSourceLabel ? (
                      <small className="truncate text-xs opacity-60">{searchSourceLabel(row.folderId)}</small>
                    ) : null}
                  </span>
                )}
              </TableCell>
              <TableCell align="right" className="tabular-nums opacity-80">
                {row.sizeText ?? '—'}
              </TableCell>
              <TableCell className="opacity-80">{row.dateText}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
      </Table>
    </div>

  )
}
