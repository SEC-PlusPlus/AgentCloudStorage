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
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'
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
import { Badge } from '@/components/glinui/components/badge'
import { Button } from '@/components/glinui/components/button'
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="trash-page">
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
        <>
          <Table variant="glass" interactive rowDividers containerClassName="overflow-x-auto">
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead align="right" className="w-28">大小</TableHead>
                <TableHead className="w-32">删除日期</TableHead>
                <TableHead className="w-32">原目录</TableHead>
                <TableHead align="right" className="w-44">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-testid={`trash-row-${item.id}`}>
                  <TableCell truncate>
                    <span className="inline-flex max-w-full items-center gap-2">
                      <FileText size={16} className="shrink-0 opacity-60" />
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
              ))}
            </TableBody>
          </Table>
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
        </>
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
