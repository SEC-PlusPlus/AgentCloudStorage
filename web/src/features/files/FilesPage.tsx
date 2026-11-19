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
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/glinui/components/alert'
import { Badge } from '@/components/glinui/components/badge'
import { Button } from '@/components/glinui/components/button'
import { DropOverlay } from '@/components/app/DropOverlay'
import { Empty } from '@/components/app/Empty'
import { Pagination } from '@/components/app/Pagination'
import { folderIdFromLocation } from '@/components/app/TopBar'
import { ApiError } from '@/api/client'
import { isUsableTrail, navTrailKey, setTrail } from '@/features/files/crumbs'
import { useUploadManager } from './useUploadManager'
import { FilesTable } from './FilesTable'
import { useFileRows } from './useFileRows'

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
    </div>
  )
}
