// 回收站页（Task 11 / spec §5.4）：同外壳复用——vendored `Table` 原语 + self-build Pagination/Empty。
// 行集 files-only（回收站无文件夹语义），故不进 FilesTable 的勾选/预览/右键回调缝，直接以原语组表；
// mergeRows 不适用（dateText=created_at 且行契约无 folder_id/deleted_at），本页自带薄映射。
// 列集（plan Interfaces）：名称 / 大小 / 删除日期（T13 carry #20 改回旧 verbatim「删除日期」，
// adbcfba TrashPage.vue:71；deleted_at 经 formatDate，缺失「—」=旧 date() 兜底）
// / 原目录（**只读 ['navTrail'] 缓存**，尾项名命中即显；未命中 `#<folder_id>` 兜底——裁定不为这一列
// 触发 BFS 冷扫描）/ 操作（恢复直按、永久删除走 alert-dialog）。
// 文案全部逐字移植 adbcfba TrashPage.vue：页头/副标题/N 个项目/加载/空态两行/底部警示条/
// 确认弹窗（「永久删除“X”？该操作无法撤销。」——spec 点名的「永久删除后无法恢复」在逐字移植的
// 底部警示条在场）/ 成功 toast / ApiError 中文透传 + 旧非 ApiError 兜底文案。
// 失效零分叉：restore/perm-delete 键表直接吃 actions.computeInvalidations（toFolder=文件 folder_id，
// 回收站无当前目录语境，currentFolder 形参对这两型不参与计算）。成功后 ['trash'] 前缀失效自带重取
// （=旧 load()），失败只 toast 不失效。
// 越页钳位（FilesPage Important #1 同因同修）：后端对 page>ceil(total/pageSize) 返回 200+空 items，
// ?page= 深链/回退可落在死页——replace 回最后有效页；total≤pageSize 不渲染分页条（旧 v-if 语义）。
// Task 2-B 追加：行首 checkbox 列（abc-3 面板数据源=勾选集合，与 FilesTable 同纪律；本地 selection，
// items 换引用即清不泄漏）→ lg 起右栏 DetailPanel：仅元数据+「恢复」（复用 runRestore，批量=顺序逐个）。
// **abc-2 钉死：永久删除永不进面板**——面板非确认渠道（防误触），确认语义=行内按钮→AlertDialog 专用。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/glinui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/glinui/components/alert-dialog'
import { RotateCcw } from 'lucide-react'
import { Badge } from '@/components/glinui/components/badge'
import { Button } from '@/components/glinui/components/button'
import { Checkbox } from '@/components/glinui/components/checkbox'
import { Skeleton } from '@/components/glinui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/glinui/components/table'
import { Empty } from '@/components/app/Empty'
import { GopherScene } from '@/components/app/GopherScene'
import { Pagination } from '@/components/app/Pagination'
import { ApiError } from '@/api/client'
import { listTrash, permanentlyDelete, restoreFile, type FileItem } from '@/api/storage'
import { isUsableTrail, navTrailKey } from '@/features/files/crumbs'
import { applyInvalidations, computeInvalidations } from '@/features/files/actions'
// Task 1-A：行类型图标走 lib/file-icons 共享逻辑（回收站行无 kind 判别——恒文件族）；
// 内滚常量/容器类从 FilesTable 单源共享（brief：TrashPage shares it）。
import { FILE_ICON_KIND_LABEL, FILE_ICON_TONE_CLASS, classifyFileIcon, fileIcon } from '@/lib/file-icons'
import { DetailPanel } from '@/features/files/DetailPanel'
import type { DetailPanelAction, DetailPanelSubject } from '@/features/files/DetailPanel'
import { LIST_SCROLL_CONTAINER_CLASS, listScrollFrameStyle } from '@/features/files/FilesTable'
import { PAGE_SIZE } from '@/features/files/useFileRows'
import { formatBytes, formatDate } from '@/lib/format'

/** 旧 TrashPage `cause instanceof ApiError ? cause.message : '…'` 的每操作兜底形态（非通用 mutationErrorMessage，旧文案不同）。 */
const trashError = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback

/**
 * 原目录列名（纯函数）：['navTrail', folderId] 缓存命中且可用（isUsableTrail 同源谓词，
 * 拒降级空名链）→ 尾项名；未命中 → `#<folder_id>` 兜底。缓存读为渲染期同步快照：
 * 本列只服务展示，恢复/删除后列表重取自然重算，无需订阅。
 */
export function sourceFolderLabel(cached: unknown, folderId: number): string {
  if (isUsableTrail(cached, folderId)) return cached[cached.length - 1]?.name ?? `#${folderId}`
  return `#${folderId}`
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw ?? 1)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const LOADING_ROWS = 5

export function TrashPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const page = parsePage(searchParams.get('page'))

  const [busyId, setBusyId] = useState<number | null>(null)
  const [destroyTarget, setDestroyTarget] = useState<FileItem | null>(null)

  // 键 ['trash', page]：与 actions.ts TRASH=['trash'] 前缀失效契约同源（restore/perm-delete 均覆盖）。
  const listQuery = useQuery({ queryKey: ['trash', page], queryFn: () => listTrash(page) })
  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])
  const total = listQuery.data?.pagination.total ?? 0
  const pageSize = listQuery.data?.pagination.page_size ?? PAGE_SIZE

  const isPending = listQuery.isPending
  const isError = listQuery.isError
  const lastValidPage = Math.max(1, Math.ceil(total / pageSize))
  const outOfRange = !isPending && !isError && total > 0 && page > lastValidPage

  useEffect(() => {
    if (!outOfRange) return
    const params = new URLSearchParams(searchParams)
    if (lastValidPage <= 1) params.delete('page')
    else params.set('page', String(lastValidPage))
    setSearchParams(params, { replace: true })
  }, [outOfRange, lastValidPage, searchParams, setSearchParams])

  const runRestore = async (item: FileItem) => {
    setBusyId(item.id)
    try {
      await restoreFile(item.id)
      applyInvalidations(
        queryClient,
        computeInvalidations({ type: 'restore', toFolder: item.folder_id }, 0),
      )
      toast(`“${item.original_name}”已恢复。`) // 旧文案逐字
    } catch (error) {
      toast.error(trashError(error, '恢复失败，请重试。'))
    } finally {
      setBusyId(null)
    }
  }

  const runDestroy = async (item: FileItem) => {
    setBusyId(item.id)
    try {
      await permanentlyDelete(item.id)
      applyInvalidations(queryClient, computeInvalidations({ type: 'perm-delete' }, 0))
      toast(`“${item.original_name}”已永久删除。`) // 旧文案逐字
    } catch (error) {
      toast.error(trashError(error, '永久删除失败，请重试。'))
    } finally {
      setBusyId(null)
    }
  }

  // —— Task 2-B 勾选→详情面板（本地 selection：回收站不借 FilesTable 缝，行集 files-only）——
  // items 换引用（翻页/重取/恢复后 invalidate）即清勾选，防陈旧集合跨页泄漏给批量恢复（FilesTable 同纪律）。
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const prevItemsRef = useRef(items)
  useEffect(() => {
    if (prevItemsRef.current === items) return
    prevItemsRef.current = items
    setSelectedIds(new Set())
  }, [items])
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds])
  const allChecked = items.length > 0 && selectedItems.length === items.length
  const toggleRow = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(items.map((item) => item.id)) : new Set())
  }

  const trashSubjectOf = (item: FileItem): DetailPanelSubject => {
    const kind = classifyFileIcon(item.original_name, item.content_type)
    return {
      key: `trash:${item.id}`,
      name: item.original_name,
      icon: fileIcon(item.original_name, item.content_type),
      toneClass: FILE_ICON_TONE_CLASS[kind],
      fields: [
        { label: '类型', value: FILE_ICON_KIND_LABEL[kind] },
        { label: '大小', value: formatBytes(item.size) },
        { label: '删除日期', value: item.deleted_at ? formatDate(item.deleted_at) : '—' },
        // 原目录口径=列表现列（sourceFolderLabel 缓存快照，冷兜底 `#<id>`，所在目录 label 统一面板词汇）
        { label: '所在目录', value: sourceFolderLabel(queryClient.getQueryData(navTrailKey(item.folder_id)), item.folder_id) },
      ],
    }
  }
  const singleSelected = selectedItems.length === 1 ? (selectedItems[0] ?? null) : null
  // abc-2：单行动作组**只有恢复**——永久删除永不进面板（确认渠道=行内按钮→AlertDialog 专用）。
  const panelActions: DetailPanelAction[] = singleSelected
    ? [
        {
          label: '恢复',
          icon: RotateCcw,
          disabled: busyId === singleSelected.id,
          reason: '正在处理该项…',
          onClick: () => void runRestore(singleSelected),
        },
      ]
    : []
  // 批量恢复=顺序逐个复用 runRestore（零 fork mutation；失败继续语义同回收站批量惯例，每项自带 toast/错误透传）。
  const runRestoreAll = async () => {
    for (const item of [...selectedItems]) await runRestore(item)
  }
  const panelBulkActions: DetailPanelAction[] =
    selectedItems.length > 1 ? [{ label: '恢复全部', icon: RotateCcw, onClick: () => void runRestoreAll() }] : []

  // Task 1-A 密度：与 FilesPage 同组容器类替换（1440px 带宽 + gap-3 节奏）
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3" data-testid="trash-page">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium text-[var(--color-foreground)]">回收站</h1>
        <Badge variant="glass">{total} 个项目</Badge>
      </div>
      <p className="text-sm text-[var(--color-foreground)] opacity-70">这里的文件可以恢复，或永久删除。</p>

      {isPending ? (
        <div aria-busy="true" data-testid="trash-loading" className="flex flex-col gap-2">
          <p role="status" className="text-sm text-[var(--color-foreground)] opacity-70">
            正在读取回收站…
          </p>
          <Table variant="glass" rowDividers containerClassName="overflow-x-auto">
            <TableHeader>
              <TableRow>
                {/* Task 2-B：勾选列进数据表——骨架列同构补位（FilesTable 惯例：loading→loaded 零列宽跳动） */}
                <TableHead className="w-10" />
                <TableHead>名称</TableHead>
                <TableHead align="right" className="w-28">大小</TableHead>
                <TableHead className="w-32">删除日期</TableHead>
                <TableHead className="w-32">原目录</TableHead>
                <TableHead align="right" className="w-44">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: LOADING_ROWS }, (_, index) => (
                <TableRow key={index} aria-hidden="true">
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-2/3" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 justify-self-end" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28 justify-self-end" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : isError ? (
        <Alert variant="destructive" data-testid="trash-error">
          <AlertDescription>
            {trashError(listQuery.error, '暂时无法读取回收站。')}
          </AlertDescription>
        </Alert>
      ) : items.length === 0 && !outOfRange ? (
        <Empty title="回收站是空的" description="被移入回收站的文件会显示在这里。">
          {/* T13 carry #22：trash 空态接入品牌场景（brief Step 1「登录/空态接入 GopherScene」）。 */}
          <GopherScene className="max-w-[480px]" />
        </Empty>
      ) : (
        // Task 2-B：内容列 lg 起双栏（主列表 flex-1 + 右 aside ~340px，<lg aside hidden 回单栏）
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="contents" style={listScrollFrameStyle}>
          <Table variant="glass" interactive rowDividers stickyHeader containerClassName={LIST_SCROLL_CONTAINER_CLASS}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    size="sm"
                    aria-label="全选本页"
                    checked={allChecked ? true : selectedItems.length > 0 ? 'indeterminate' : false}
                    onCheckedChange={(value) => toggleAll(value === true)}
                  />
                </TableHead>
                <TableHead>名称</TableHead>
                <TableHead align="right" className="w-28">大小</TableHead>
                <TableHead className="w-32">删除日期</TableHead>
                <TableHead className="w-32">原目录</TableHead>
                <TableHead align="right" className="w-44">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const Icon = fileIcon(item.original_name, item.content_type)
                return (
                <TableRow key={item.id} data-testid={`trash-row-${item.id}`}>
                  <TableCell>
                    <Checkbox
                      size="sm"
                      aria-label={`选择 ${item.original_name}`}
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={(value) => toggleRow(item.id, value === true)}
                    />
                  </TableCell>
                  <TableCell truncate>
                    {/* 类型图标与 FilesTable 同逻辑（行内位保留——回收站无勾选列，不再开独立图标列；
                        icon-frame 缺位 span 自绘裁定见 lib/file-icons.ts FILE_ICON_TONE_CLASS 头注） */}
                    <span className="inline-flex max-w-full items-center gap-2">
                      <span
                        aria-hidden="true"
                        data-testid={`trash-row-icon-${item.id}`}
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)]/60 ${FILE_ICON_TONE_CLASS[classifyFileIcon(item.original_name, item.content_type)]}`}
                      >
                        <Icon size={16} className="shrink-0" />
                      </span>
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate">{item.original_name}</span>
                        <small className="truncate text-xs opacity-60">
                          {item.content_type || '未知类型'}
                        </small>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell align="right" className="tabular-nums opacity-80">
                    {formatBytes(item.size)}
                  </TableCell>
                  <TableCell className="opacity-80">
                    {item.deleted_at ? formatDate(item.deleted_at) : '—'}
                  </TableCell>
                  <TableCell className="opacity-80">
                    {sourceFolderLabel(queryClient.getQueryData(navTrailKey(item.folder_id)), item.folder_id)}
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="glass"
                        disabled={busyId === item.id}
                        onClick={() => void runRestore(item)}
                      >
                        恢复
                      </Button>
                      <Button
                        size="sm"
                        variant="glass"
                        className="text-red-600 dark:text-red-400"
                        disabled={busyId === item.id}
                        onClick={() => setDestroyTarget(item)}
                      >
                        永久删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
          {total > pageSize ? (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onChange={(next) => {
                const params = new URLSearchParams(searchParams)
                if (next <= 1) params.delete('page')
                else params.set('page', String(next))
                setSearchParams(params)
              }}
            />
          ) : null}
          </div>
          <DetailPanel
            selection={selectedItems.map(trashSubjectOf)}
            actions={panelActions}
            bulkActions={panelBulkActions}
            onClose={() => setSelectedIds(new Set())}
          />
        </div>
      )}

      {/* 旧底部警示条逐字（含 spec §5.4 点名的「永久删除后无法恢复」句）。 */}
      <p
        data-testid="trash-warning"
        className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-[var(--color-foreground)] opacity-90"
      >
        <span aria-hidden="true">!</span>
        永久删除后无法恢复。恢复的文件会回到原目录；如果原目录不存在，服务端可能无法恢复。
      </p>

      {/* 永久删除确认：标题/正文/按钮全旧文案逐字（ElMessageBox → vendored alert-dialog）。 */}
      <AlertDialog
        open={destroyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDestroyTarget(null)
        }}
      >
        <AlertDialogContent variant="glass" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除文件</AlertDialogTitle>
            <AlertDialogDescription>
              {destroyTarget ? `永久删除“${destroyTarget.original_name}”？该操作无法撤销。` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="text-red-600 dark:text-red-400"
              onClick={() => {
                if (destroyTarget) void runDestroy(destroyTarget)
                setDestroyTarget(null)
              }}
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
