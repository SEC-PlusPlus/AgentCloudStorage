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
// Task 10 追加：预览 sheet 接线——previewRow 状态 + openPreview 单点汇入（双击行/右键「预览」/
// 单击·Enter 文件名按钮三路，评审强制项⑭）；下载/关闭在 sheet 头部自足，问 AI 恒 disabled 至 Task 12。
// Task 2-B（布局密度）追加：checkbox selection 派生右栏 DetailPanel（lg 起双栏、窄屏 hidden 单栏；
// abc-3 面板数据源=勾选集合，单击行名预览/进目录不劫持；abc-4 单选浮条隐藏、面板唯一动作载体——
// 面板动作全部复用本页既有 handler（openPreview/runDownload/setRenameTarget/setMoveTarget/openAsk/
// setDeleteTargets），零第二套 mutation；「所在目录」行复用 searchSourceLabel 同函数无 BFS；
// 关闭钮=清 selection + clearSelectionToken 递增经 FilesTable 缝双向复位 checkbox）。
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
import { Download, Eye, FolderInput, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/glinui/components/badge'
import { Button } from '@/components/glinui/components/button'
import { DropOverlay } from '@/components/app/DropOverlay'
import { Empty } from '@/components/app/Empty'
import { GopherScene } from '@/components/app/GopherScene'
import { Pagination } from '@/components/app/Pagination'
import { folderIdFromLocation } from '@/components/app/TopBar'
import { ApiError } from '@/api/client'
import { deleteFolder, downloadFile, trashFile, type FileItem } from '@/api/storage'
import { isUsableTrail, navTrailKey, setTrail } from '@/features/files/crumbs'
import { canAsk } from '@/features/qa/qa-state'
import { QaSheet } from '@/features/qa/QaSheet'
import {
  FILE_ICON_KIND_LABEL,
  FILE_ICON_TONE_CLASS,
  FOLDER_ICON,
  FOLDER_TONE_CLASS,
  classifyFileIcon,
  fileIcon,
} from '@/lib/file-icons'
import { DetailPanel } from './DetailPanel'
import type { DetailPanelAction, DetailPanelSubject } from './DetailPanel'
import { applyInvalidations, computeInvalidations, mutationErrorMessage } from './actions'
import { MoveDialog } from './MoveDialog'
import { PreviewSheet } from './PreviewSheet'
import { RenameDialog } from './RenameDialog'
import { RowContextMenu } from './RowContextMenu'
import { RowToolbar } from './RowToolbar'
import { useUploadManager } from './useUploadManager'
import { FilesTable, searchSourceLabel } from './FilesTable'
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

  // T13 carry #14（Task 9 minor ⑪）：搜索态命中来自任意目录且 URL 无 folder 语境（folderId=0）——
  // 动作失效的 from 键必须改用行真实源目录 items[].folder_id（useFileRows 已透传 items），
  // 否则 ['files',0] 空失效、源目录幽灵行滞留。浏览态行为不变（行必在当前目录，from=folderId）。
  // 搜索态行集恒 files-only（mergeRows ④），id 查 items 必命中；多源批量=按源目录去重逐个失效。
  const sourceFolderOf = (rowIds: number[]): number[] => {
    if (!state.keywordMode) return [folderId]
    const ids = new Set<number>()
    for (const item of state.items) if (rowIds.includes(item.id)) ids.add(item.folder_id)
    return ids.size > 0 ? [...ids] : [folderId]
  }

  // Task 9 操作集状态：勾选集合（浮条消费）、右键目标+坐标（菜单消费）、三个待办弹窗的行参数。
  const [selection, setSelection] = useState<FileRow[]>([])
  const [contextMenu, setContextMenu] = useState<{ row: FileRow; pos: { x: number; y: number } } | null>(null)
  const [renameTarget, setRenameTarget] = useState<FileRow | null>(null)
  const [moveTarget, setMoveTarget] = useState<FileRow | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<FileRow[] | null>(null)
  // Task 10 预览接线：双击行 / 右键「预览」/ 单击·Enter 文件名按钮（⑭）三路同源汇入 sheet。
  const [previewRow, setPreviewRow] = useState<FileRow | null>(null)
  const openPreview = (row: FileRow) => {
    if (row.kind === 'file') setPreviewRow(row) // 文件夹行防御性忽略（入口均限 file，双保险）
  }
  // Task 12 问答接线：三路入口（浮条/右键菜单/预览头部）汇入；旧 openAsk 的「开问答先关预览」
  // 语义逐字承接（adbcfba:312）。卸载 qaRow 即清对话（QaSheet 头注生命周期裁定）。
  const [qaRow, setQaRow] = useState<FileRow | null>(null)
  const openAsk = (row: FileRow) => {
    if (row.kind !== 'file' || !canAsk(row).ok) return // 入口已门控，此为汇入点终闸（文件夹行防御同 openPreview）
    // T13 carry #21a 镜像：旧 :312 序列是「先关旧问答会话再开新」；新版「已开 ask 中换文件」路径由
    // 挂载点 QaSheet key={qaRow.id} 的 remount 等价达成（清旧对话+abort 在途），当前由 modal 不可达掩护，属防御性覆盖。
    setPreviewRow(null)
    setQaRow(row)
  }

  // Task 2-B 详情面板派生：subjects=selection 映射（abc-3 唯一数据源=checkbox 勾选集合）；
  // 「所在目录」复用行副标题同款 searchSourceLabel（渲染期只读 ['navTrail'] 缓存快照，无 BFS）；
  // 关闭钮=页面清 selection + token 递增经 FilesTable 缝双向复位内部 checkbox（不反向回抛成环）。
  const [clearSelectionToken, setClearSelectionToken] = useState(0)
  const clearPanelSelection = () => {
    setSelection([])
    setClearSelectionToken((token) => token + 1)
  }
  const panelSubjectOf = (row: FileRow): DetailPanelSubject => {
    // 浏览态行 folderId 恒=当前目录（folder 行契约无该字段，容器=folderId）；搜索态文件行=真实源目录。
    const locationId = row.kind === 'file' ? row.folderId : folderId
    const iconKind = row.kind === 'folder' ? null : classifyFileIcon(row.name, row.contentType)
    return {
      key: `${row.kind}:${row.id}`,
      name: row.name,
      icon: row.kind === 'folder' ? FOLDER_ICON : fileIcon(row.name, row.contentType),
      toneClass: row.kind === 'folder' ? FOLDER_TONE_CLASS : FILE_ICON_TONE_CLASS[iconKind!],
      fields: [
        { label: '类型', value: iconKind === null ? '文件夹' : FILE_ICON_KIND_LABEL[iconKind] },
        { label: '大小', value: row.kind === 'file' ? row.sizeText : '—' },
        { label: '修改时间', value: row.dateText },
        { label: '所在目录', value: searchSourceLabel(queryClient.getQueryData(navTrailKey(locationId)), locationId) },
      ],
    }
  }
  const selectionSingle = selection.length === 1 ? (selection[0] ?? null) : null
  // 单行动作组（abc-4：面板=单选唯一动作载体）——brief §B 钉死五钮全显、不可用置灰带 reason（⑮ 模式）；
  // 危险动作「移入回收站」按 brief 不进单行组（入口=右键菜单/批量侧），确认渠道保持对话框专用。
  const panelActions: DetailPanelAction[] = selectionSingle
    ? (() => {
        const row = selectionSingle
        const isFile = row.kind === 'file'
        const askGate = canAsk(row)
        return [
          { label: '预览', icon: Eye, disabled: !isFile, reason: '文件夹不支持预览。', onClick: () => openPreview(row) },
          { label: '下载', icon: Download, disabled: !isFile, reason: '文件夹不可下载。', onClick: () => void runDownload(selection) },
          { label: '重命名', icon: Pencil, onClick: () => setRenameTarget(row) },
          { label: '移动', icon: FolderInput, onClick: () => setMoveTarget(row) },
          { label: '问 AI', icon: Sparkles, disabled: !askGate.ok, reason: askGate.reason, onClick: () => openAsk(row) },
        ]
      })()
    : []
  // 多行批量组（与 RowToolbar 并存，abc-4；语义=既有 runTrash 确认弹窗 / runDownload 逐个文件）。
  const panelBulkActions: DetailPanelAction[] =
    selection.length > 1
      ? [
          {
            label: '下载全部',
            icon: Download,
            disabled: !selection.some((row) => row.kind === 'file'),
            reason: '所选均为文件夹，无可下载项。',
            onClick: () => void runDownload(selection),
          },
          { label: '移入回收站', icon: Trash2, danger: true, onClick: () => setDeleteTargets(selection) },
        ]
      : []

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
  // T13 carry #16（Task 9 minor ⑬）批量失败语义「择一」定样（注释惯例，行为不变）：
  // 下载=首个失败即中断（半途混批下载状态对用户无提示价值，错误文案已到位即停）；
  // 回收站=继续逐个+聚合首个错误（删除类动作部分成功更常见，剩余项状态对用户仍有效）。
  // 两向并存是有意的惯例（保守不可逆侧停止、可提示侧继续），不是疏漏。
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
    // 失效逐源执行（T13 carry #14）：搜索态批量可跨源目录；browse 态 sourceFolderOf 恒 [folderId] 单次。
    for (const from of sourceFolderOf(rows.map((row) => row.id))) {
      applyInvalidations(queryClient, computeInvalidations({ type: 'trash', fromFolder: from }, folderId))
    }
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

  // Task 1-A 密度：max-w-5xl(64rem)→1440px 宽屏带（验收基线 1440 屏 ≥1360 可用宽）、gap-4→gap-3
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3" data-testid="files-page">
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
        >
          {/* T13 carry #22：files 空态=品牌场景接入（旧 AuthPage StorageScene 的移植件）；
              搜索无结果是瞬态（清除搜索按钮已自足），不挂场景免噪音。 */}
          {!state.keywordMode ? <GopherScene className="max-w-[480px]" /> : null}
        </Empty>
      ) : (
        // Task 2-B：内容列 lg 起双栏——主列表 flex-1 + 右 aside ~340px（<lg aside hidden 回单栏）。
        <div className="flex items-start gap-3">
          {/* 主列保持原 flex-col gap-3 节奏（列表↔分页间距不随双栏化丢失；列表本体 display:contents 透明） */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
          <FilesTable
            rows={state.rows}
            loading={state.isLoading}
            // 终评修波 3：仅搜索态注入源目录副标题（渲染期只读 ['navTrail'] 缓存快照，
            // cache-hit 链尾名 / cache-miss「目录 <id>」/ 根=「根目录」——TrashPage 原目录同纪律，无 BFS）。
            searchSourceLabel={
              state.keywordMode
                ? (folderId) => searchSourceLabel(queryClient.getQueryData(navTrailKey(folderId)), folderId)
                : undefined
            }
            onFolderOpen={(row) => handleFolderOpen(row.id, row.name, row.kind)}
            onPreview={openPreview}
            onSelectionChange={setSelection}
            onContext={(row, pos) => setContextMenu({ row, pos })}
            clearSelectionToken={clearSelectionToken}
          />
          {!state.isLoading && state.total > 0 ? (
            <Pagination
              page={page}
              pageSize={state.pageSize}
              total={state.total}
              onChange={handlePageChange}
            />
          ) : null}
          </div>
          <DetailPanel
            selection={selection.map(panelSubjectOf)}
            actions={panelActions}
            bulkActions={panelBulkActions}
            onClose={clearPanelSelection}
          />
        </div>
      )}

      {/* 拖放上传：仅浏览模式挂载（搜索态禁拖入=旧 onDrop 行为）；落点目录=当前 ?folder= */}
      {!state.keywordMode ? (
        <DropOverlay onFiles={(files) => uploadManager.submitFiles(files, folderId)} />
      ) : null}

      {/* —— Task 9 操作集：浮条 / 右键菜单 / 三弹窗（勾选跨页清空由 FilesTable 缝上抛 [] 保证） —— */}
      {/* Task 2-B（abc-4）：浮条收窄为多选专属批量载体（下载/移入回收站），单目标动作全部走面板/右键菜单 */}
      <RowToolbar
        selection={selection}
        onDownload={() => void runDownload(selection)}
        onTrash={() => setDeleteTargets(selection)}
      />
      <RowContextMenu
        row={contextMenu?.row ?? null}
        pos={contextMenu?.pos ?? null}
        onClose={() => setContextMenu(null)}
        onPreview={openPreview} // Task 10 预览接线（右键「预览」与双击/键盘同源汇入 PreviewSheet）
        onDownload={(row) => void runDownload([row])}
        onRename={setRenameTarget}
        onMove={setMoveTarget}
        onTrash={(row) => setDeleteTargets([row])}
        onAsk={openAsk} // Task 12：菜单项 canAsk 门控启用（不合格=disabled 不可 select）
      />
      {/* Task 10 预览 sheet：常驻挂载，row 引用变化驱动取数/blob 释放（PreviewSheet 头注）；
          Task 12 接线：头部「问 AI」canAsk 门控 → openAsk（同旧版开问答先关预览）。 */}
      <PreviewSheet row={previewRow} onClose={() => setPreviewRow(null)} onAsk={openAsk} />
      {/* Task 12 问答 sheet：条件挂载——关闭=卸载=清对话+abort 在途（QaSheet 生命周期裁定）。
          T13 carry #21a：key={qaRow.id} 一字加固——若「已开 ask 中换文件再 ask」路径出现
          （现由 modal 不可达掩护，旧版 :312 靠先关旧会话达成），remount 即清旧对话+abort 在途，语义同旧。 */}
      {qaRow ? <QaSheet key={qaRow.id} row={qaRow} open onClose={() => setQaRow(null)} /> : null}
      {/* T13 carry #14：搜索态弹窗的 from 失效键=行真实源目录（folder_id），browse 态与缺省等价。 */}
      <RenameDialog
        target={renameTarget}
        fromFolder={renameTarget ? sourceFolderOf([renameTarget.id])[0] : undefined}
        onClose={() => setRenameTarget(null)}
      />
      <MoveDialog
        target={moveTarget}
        fromFolder={moveTarget ? sourceFolderOf([moveTarget.id])[0] : undefined}
        onClose={() => setMoveTarget(null)}
      />
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
