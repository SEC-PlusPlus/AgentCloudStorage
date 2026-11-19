// 文件工作台页（Task 7 / spec §5.2）：URL 即状态（?folder=/?q=/?page= 全 searchParams 驱动，
// 前进/后退天然正确，不建第二套本地状态）。
// 导航进目录 = URL 更新 + navTrail 追加（crumbs.ts 契约）：当前链可用时 setTrail 写回
// 「现链 + 点击目录」；可用性判定直接调用 crumbs.isUsableTrail（修复轮 1 / Important #2：
// 写闸与 fast-path 同源，杜绝内联复制丢守卫的漂移类）；不可用链不回写半截，
// 让 TopBar 的 resolveAncestorPath BFS 自愈重试（深链场景点击子目录属罕见路径，不伪造前缀）。
// 越页兜底（修复轮 1 / Important #1）：后端对 page>ceil(total/pageSize) 返回 200+空 items
// （file_handler.go:185-238），这不是空目录——落定后 replace 回最后有效页，历史不留死页。
// Task 8 追加：工具栏「上传文件」入口 + 拖放上传（DropOverlay 仅浏览模式挂载——旧 FileWorkbench
// onDrop 的 `if (isSearching...) return` 等价且更强：搜索态连遮罩视觉都不出现；投放目录=当前 ?folder=）。
// Task 9 追加：操作集接线——Task 7 的三条回调缝全部接实：onSelectionChange→浮动操作条（RowToolbar）、
// onContext→右键菜单（RowContextMenu，隐藏锚点+合成事件开菜单）；重命名/移动/回收站确认三弹窗挂载本页，
// 失效经 actions.computeInvalidations → applyInvalidations（成功 toast + 错误中文透传双载体，弹窗内
// errorMessage 载具按评审裁定换为 sonner toast）。旧版行内「更多」下拉的职责由右键菜单承接。
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/glinui/components/alert'
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
import { DropOverlay } from '@/components/app/DropOverlay'
import { Empty } from '@/components/app/Empty'
import { Pagination } from '@/components/app/Pagination'
import { folderIdFromLocation } from '@/components/app/TopBar'
import { ApiError } from '@/api/client'
import { deleteFolder, downloadFile, trashFile, type FileItem } from '@/api/storage'
import { isUsableTrail, navTrailKey, setTrail } from '@/features/files/crumbs'
import { applyInvalidations, computeInvalidations, mutationErrorMessage } from './actions'
import { MoveDialog } from './MoveDialog'
import { RenameDialog } from './RenameDialog'
import { RowContextMenu } from './RowContextMenu'
import { RowToolbar } from './RowToolbar'
import { useUploadManager } from './useUploadManager'
import { FilesTable } from './FilesTable'
import { useFileRows } from './useFileRows'
import type { FileRow } from './useFileRows'

/** 回收站确认弹窗文案（旧 removeEntry 原文逐字；多选为新版能力，文案新拟）。 */
function formatDeleteCopy(rows: FileRow[] | null): string {
  if (!rows || rows.length === 0) return ''
  const [only] = rows
  if (rows.length === 1 && only) {
    return only.kind === 'file'
      ? `将“${only.name}”移入回收站？`
      : `删除文件夹“${only.name}”？该操作仅能删除空文件夹。`
  }
  return `将 ${rows.length} 个项目移入回收站？文件夹需为空才能删除。`
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw ?? 1)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const uploadManager = useUploadManager()

  const folderId = folderIdFromLocation(pathname, search)
  const keyword = searchParams.get('q')
  const page = parsePage(searchParams.get('page'))

  const state = useFileRows(folderId, page, keyword)

  // Task 9 操作集状态：勾选集合（浮条消费）、右键目标+坐标（菜单消费）、三个待办弹窗的行参数。
  const [selection, setSelection] = useState<FileRow[]>([])
  const [contextMenu, setContextMenu] = useState<{ row: FileRow; pos: { x: number; y: number } } | null>(null)
  const [renameTarget, setRenameTarget] = useState<FileRow | null>(null)
  const [moveTarget, setMoveTarget] = useState<FileRow | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<FileRow[] | null>(null)

  // 越页兜底（Important #1）：后端越页返回 200+空 items + 真实 total——空 rows≠空目录。
  // 落定后 replace 到最后一有效页（total=0 不钳位：那是真空态，Empty 负责）。
  const lastValidPage = Math.max(1, Math.ceil(state.total / state.pageSize))
  const outOfRange = !state.isLoading && !state.isError && state.total > 0 && page > lastValidPage

  useEffect(() => {
    if (!outOfRange) return
    const params = new URLSearchParams(searchParams)
    if (lastValidPage <= 1) params.delete('page')
    else params.set('page', String(lastValidPage))
    setSearchParams(params, { replace: true })
  }, [outOfRange, lastValidPage, searchParams, setSearchParams])

  const handleFolderOpen = (rowId: number, rowName: string, rowKind: string) => {
    if (rowKind !== 'folder') return
    // 写闸与 crumbs fast-path 同源（Important #2）：isUsableTrail 谓词含尾 id 匹配、
    // typeof name 字符串守卫、非空名三重检查；不可用链不回写半截，BFS 自愈留权重挂载。
    const cached = queryClient.getQueryData(navTrailKey(folderId))
    if (isUsableTrail(cached, folderId)) {
      setTrail(queryClient, rowId, [...cached, { id: rowId, name: rowName }])
    }
    // 进目录回到浏览态：清 q / 清 page（新目录从第 1 页看起）
    const next = new URLSearchParams({ folder: String(rowId) })
    navigate({ pathname: '/files', search: `?${next}` })
  }

  const handlePageChange = (next: number) => {
    const params = new URLSearchParams(searchParams)
    if (next <= 1) params.delete('page')
    else params.set('page', String(next))
    setSearchParams(params)
  }

  // 下载：旧 startDownload 语义（busy 锁由 pending 天然覆盖——fetch 完成即 toast）；
  // 多选=逐个文件（仅文件行，浮条过滤后传入）。emoji/unicode 文件名原样保留=downloadFile 锚点法
  // （storage.ts:120-130 仅读 id/original_name——此处收窄 cast 仅携两字段，理由注释随行为）。
  const runDownload = async (rows: FileRow[]) => {
    for (const row of rows) {
      if (row.kind !== 'file') continue
      try {
        await downloadFile({ id: row.id, original_name: row.name } as FileItem)
      } catch (error) {
        toast.error(mutationErrorMessage(error))
        return
      }
    }
    if (rows.some((row) => row.kind === 'file')) toast('下载已开始。') // 旧文案
  }

  // 移入回收站/删除文件夹：旧 removeEntry 语义（确认后执行、成功 toast、错误中文透传）。
  // 多选=顺序逐个，首个错误文案上抛但其余继续（新能力，无旧对照；invalidate 一次）。
  const runTrash = async (rows: FileRow[]) => {
    let ok = 0
    let firstError: string | null = null
    for (const row of rows) {
      try {
        if (row.kind === 'file') await trashFile(row.id)
        else await deleteFolder(row.id)
        ok += 1
      } catch (error) {
        firstError ??= mutationErrorMessage(error)
      }
    }
    applyInvalidations(queryClient, computeInvalidations({ type: 'trash', fromFolder: folderId }, folderId))
    const [only] = rows
    if (ok > 0) {
      toast(
        rows.length === 1 && only
          ? only.kind === 'file'
            ? '文件已移入回收站。'
            : '文件夹已删除。'
          : `已移入回收站 ${ok} 个项目。`,
      )
    }
    if (firstError) toast.error(firstError)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="files-page">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium text-[var(--color-foreground)]">
          {state.keywordMode ? <>搜索「{keyword?.trim()}」</> : '文件'}
        </h1>
        <div className="flex items-center gap-2">
          {state.keywordMode && !state.isLoading && !state.isError ? (
            <span data-testid="search-count">
              <Badge variant="glass">{state.total} 个结果</Badge>
            </span>
          ) : null}
          {/* 旧工具栏上传按钮语义：busy（队列搬运中）|| isSearching（?q=）禁用 */}
          <Button
            variant="glass"
            size="sm"
            disabled={state.keywordMode || uploadManager.busy}
            onClick={uploadManager.openPicker}
          >
            上传文件
          </Button>
        </div>
      </div>

      {state.isError ? (
        <Alert variant="destructive" data-testid="files-error">
          <AlertTitle>读取文件列表失败</AlertTitle>
          <AlertDescription>
            {state.error instanceof ApiError ? state.error.message : '服务暂时遇到问题，请稍后重试。'}
          </AlertDescription>
        </Alert>
      ) : state.isEmpty && !outOfRange ? (
        <Empty
          title={
            state.keywordMode
              ? `没有找到「${keyword?.trim()}」相关文件`
              : folderId === 0
                ? '云仓还是空的'
                : '这个目录还没有内容'
          }
          description={
            state.keywordMode
              ? '换个关键词试试，或从顶部搜索框重新搜索。'
              : '可以从底部 Dock 上传第一个文件。'
          }
          action={
            state.keywordMode
              ? { label: '清除搜索', onClick: () => navigate({ pathname: '/files', search: '' }) }
              : undefined
          }
        />
      ) : (
        <>
          <FilesTable
            rows={state.rows}
            loading={state.isLoading}
            onFolderOpen={(row) => handleFolderOpen(row.id, row.name, row.kind)}
            onSelectionChange={setSelection}
            onContext={(row, pos) => setContextMenu({ row, pos })}
          />
          {!state.isLoading && state.total > 0 ? (
            <Pagination
              page={page}
              pageSize={state.pageSize}
              total={state.total}
              onChange={handlePageChange}
            />
          ) : null}
        </>
      )}

      {/* 拖放上传：仅浏览模式挂载（搜索态禁拖入=旧 onDrop 行为）；落点目录=当前 ?folder= */}
      {!state.keywordMode ? (
        <DropOverlay onFiles={(files) => uploadManager.submitFiles(files, folderId)} />
      ) : null}

      {/* —— Task 9 操作集：浮条 / 右键菜单 / 三弹窗（勾选跨页清空由 FilesTable 缝上抛 [] 保证） —— */}
      <RowToolbar
        selection={selection}
        onDownload={() => void runDownload(selection)}
        onMove={() => {
          const [only] = selection
          if (selection.length === 1 && only) setMoveTarget(only)
        }}
        onRename={() => {
          const [only] = selection
          if (selection.length === 1 && only) setRenameTarget(only)
        }}
        onTrash={() => setDeleteTargets(selection)}
        onAsk={() => undefined} // 浮条问 AI 按钮恒 disabled；Task 12 接线时改实
      />
      <RowContextMenu
        row={contextMenu?.row ?? null}
        pos={contextMenu?.pos ?? null}
        onClose={() => setContextMenu(null)}
        onPreview={() => undefined} // TODO(Task 10 预览接线)
        onDownload={(row) => void runDownload([row])}
        onRename={setRenameTarget}
        onMove={setMoveTarget}
        onTrash={(row) => setDeleteTargets([row])}
        onAsk={() => undefined} // 菜单项 disabled 至 Task 12
      />
      <RenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} />
      <MoveDialog target={moveTarget} onClose={() => setMoveTarget(null)} />
      <AlertDialog
        open={deleteTargets !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargets(null)
        }}
      >
        <AlertDialogContent variant="glass" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>请确认操作</AlertDialogTitle>
            <AlertDialogDescription>{formatDeleteCopy(deleteTargets)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runTrash(deleteTargets ?? [])}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
