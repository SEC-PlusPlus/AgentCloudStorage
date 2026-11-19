// 顶部细条（spec §5.2）：左品牌（BrandMark=OGA 云素材+应用名）→ 中面包屑 → 右存储用量条。
// 面包屑数据 = resolveAncestorPath（crumbs.ts，缓存键 ['navTrail', folderId]）经 useQuery 包装：
// Task 7 导航成功 setTrail 写同一键 → 此处零请求更新。folderId 读 URL `?folder=`（缺省 0，files 路由同约定）。
// 用量 = ['usage'] getStorageUsage（quota_bytes 后端见 1c2b801），窗口聚焦自动重取（brief Step 4）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { getStorageUsage } from '@/api/storage'
import { GlassBreadcrumb, type GlassBreadcrumbItem } from '@/components/glinui/components/glass-breadcrumb'
import { GlassNavbar } from '@/components/glinui/components/glass-navbar'
import { Progress } from '@/components/glinui/components/progress'
import { ROOT_FOLDER_ID, navTrailKey, resolveAncestorPath, rootCrumb, type Crumb } from '@/features/files/crumbs'
import { APP_NAME, BRAND_LOGO_SRC } from '@/lib/brand'
import { formatBytes } from '@/lib/format'

/** files 路由外的位置（/trash 等）面包屑只显示根；`?folder=` 非法值按缺省 0。 */
export function folderIdFromLocation(pathname: string, search: string): number {
  if (!pathname.startsWith('/files')) return ROOT_FOLDER_ID
  const parsed = Number(new URLSearchParams(search).get('folder') ?? ROOT_FOLDER_ID)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : ROOT_FOLDER_ID
}

export function TopBar() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const folderId = folderIdFromLocation(pathname, search)

  const trailQuery = useQuery({
    queryKey: navTrailKey(folderId),
    queryFn: () => resolveAncestorPath(folderId, queryClient),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  // 解析中/降级：先渲染单级占位（根目录静态可知，避免闪「目录 0」）；
  // 降级项 name='' 的补名契约见 crumbs.ts（Task 7 从列表数据补）。
  const crumbs: Crumb[] =
    trailQuery.data ?? (folderId === ROOT_FOLDER_ID ? [rootCrumb()] : [{ id: folderId, name: '' }])

  const breadcrumbItems: GlassBreadcrumbItem[] = crumbs.map((crumb, index) => ({
    id: String(crumb.id),
    label: crumb.name || `目录 ${crumb.id}`,
    onClick:
      index === crumbs.length - 1
        ? undefined
        : () => navigate(crumb.id === ROOT_FOLDER_ID ? '/files' : `/files?folder=${crumb.id}`),
  }))

  const usageQuery = useQuery({
    queryKey: ['usage'],
    queryFn: getStorageUsage,
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: true, // brief：窗口聚焦重取（TanStack 内置 window focus 事件）
  })
  const usage = usageQuery.data
  // quota 缺失/为 0（防御旧数据）时百分比按 0 显示，不出现 NaN。
  const percent =
    usage && usage.quota_bytes > 0
      ? Math.min(100, Math.round((usage.used_bytes / usage.quota_bytes) * 100))
      : 0

  return (
    <GlassNavbar className="flex items-center gap-4 px-6">
      {/* BrandMark（§7.1：素材不 AI、取现存设计；透明底像素云 + 应用名） */}
      <span className="flex shrink-0 items-center gap-2">
        <img
          src={BRAND_LOGO_SRC}
          alt=""
          aria-hidden="true"
          width={46}
          height={24}
          className="h-6 w-auto [image-rendering:pixelated] drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.45)]"
        />
        <span className="whitespace-nowrap text-sm font-medium text-[var(--color-foreground)]">
          {APP_NAME}
        </span>
      </span>

      <div className="min-w-0 flex-1 overflow-x-auto" data-testid="breadcrumb">
        <GlassBreadcrumb items={breadcrumbItems} maxItems={6} separator="›" />
      </div>

      <span
        className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-foreground)] opacity-80"
        data-testid="usage-bar"
      >
        {usage ? `${formatBytes(usage.used_bytes)} / ${formatBytes(usage.quota_bytes)}` : '— / —'}
        <Progress
          value={percent}
          variant="glass"
          size="sm"
          className="w-24"
          aria-label="存储空间用量"
        />
      </span>
    </GlassNavbar>
  )
}
