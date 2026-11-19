// 面包屑祖先链解析（Task 6 / spec §5.1 评审问题 3 裁定，Review Focus #3 钉死）：
// 应用内导航天然已知父链 → Task 7 成功进入目录时调用 setTrail 把链条放进 ['navTrail', folderId] 缓存；
// 深链/刷新（缓存冷）→ 自根 BFS listFolders 逐层下探定位 parent 链（个人量级可接受，5 min staleTime）；
// 遍历失败/目标不可达 → 降级为单元素 `[{ id, name: '' }]`，由调用方从当前列表数据补名
// （补名后仍应 setTrail 写回，见 crumbs.test.ts「补名契约」用例）。
import type { QueryClient } from '@tanstack/react-query'
import { listFolders } from '@/api/storage'

export type Crumb = { id: number; name: string }

export const ROOT_FOLDER_ID = 0
export const ROOT_LABEL = '根目录'

/** 导航链缓存键（约定：`['navTrail']` 前缀；见 Task 6 brief Interfaces）。 */
export const navTrailKey = (folderId: number) => ['navTrail', folderId] as const

/** BFS 借用的目录列表查询键（与 Task 7 文件列表页共用，天然预热）。 */
const foldersKey = (parentId: number) => ['folders', parentId] as const

const TRAIL_STALE_TIME = 5 * 60 * 1000

export function rootCrumb(): Crumb {
  return { id: ROOT_FOLDER_ID, name: ROOT_LABEL }
}

/**
 * 缓存写入契约（Task 7 导航成功后调用）：
 * 写 `['navTrail', folderId] = crumbs` 主条目；crumbs 尾项应为 folderId 本身。
 * 同时回填 crumbs 的全部前缀子链（每个祖先目录 → 对应截断链），
 * 使回退/进入同父兄弟目录的解析也走 fast-path。
 */
export function setTrail(queryClient: QueryClient, folderId: number, crumbs: Crumb[]): void {
  queryClient.setQueryData(navTrailKey(folderId), crumbs)
  for (let i = 0; i < crumbs.length; i++) {
    const crumb = crumbs[i]
    if (crumb) queryClient.setQueryData(navTrailKey(crumb.id), crumbs.slice(0, i + 1))
  }
}

/**
 * 只采信「尾项 id === folderId 且全链每项 name 非空」的链条。
 * name 检查是修复轮 1 / Finding #1：useQuery 会把 resolveAncestorPath 的降级返回值
 * `[{id, name:''}]` 持久化进同键缓存，仅查尾 id 会让降级态冒充 fast-path 命中、阻塞重试。
 * 无误伤风险：后端禁止空目录名，合法链（BFS 成功或 Task 7 补名后 setTrail）各项 name 恒非空；
 * 降级单元素按合同只是返回值，不是可命中的缓存态。
 */
function isUsableTrail(value: unknown, folderId: number): value is Crumb[] {
  if (!Array.isArray(value) || value.length === 0) return false
  const trail = value as Crumb[]
  const last = trail[trail.length - 1]
  if (typeof last !== 'object' || last === null || last.id !== folderId) return false
  return trail.every((crumb) => typeof crumb.name === 'string' && crumb.name !== '')
}

async function fetchChildFolders(queryClient: QueryClient, parentId: number) {
  const result = await queryClient.fetchQuery({
    queryKey: foldersKey(parentId),
    queryFn: () => listFolders(parentId),
    staleTime: TRAIL_STALE_TIME,
    retry: false,
  })
  return result.items
}

/** 自根广度优先收集祖先链；命中即返回完整链（含根），穷尽则抛错。 */
async function bfsTrailTo(queryClient: QueryClient, folderId: number): Promise<Crumb[]> {
  const queue: Crumb[][] = [[rootCrumb()]]
  const visited = new Set<number>([ROOT_FOLDER_ID])
  while (queue.length > 0) {
    const path = queue.shift() as Crumb[]
    const parent = path[path.length - 1] as Crumb
    for (const child of await fetchChildFolders(queryClient, parent.id)) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      const childPath: Crumb[] = [...path, { id: child.id, name: child.name }]
      if (child.id === folderId) return childPath
      queue.push(childPath)
    }
  }
  throw new Error(`folder ${folderId} not reachable from root`)
}

/**
 * 解析 folderId 的完整面包屑链（首项恒为根）。
 * 顺序：根特判 → ['navTrail'] 缓存 fast-path → 冷 BFS（成功即 setTrail 写回）→ 失败降级单元素。
 */
export async function resolveAncestorPath(
  folderId: number,
  queryClient: QueryClient,
): Promise<Crumb[]> {
  if (folderId === ROOT_FOLDER_ID) return [rootCrumb()]

  const cached = queryClient.getQueryData(navTrailKey(folderId))
  if (isUsableTrail(cached, folderId)) return cached

  try {
    const trail = await bfsTrailTo(queryClient, folderId)
    setTrail(queryClient, folderId, trail)
    return trail
  } catch {
    // 降级（Review Focus #3）：name 留空由调用方从列表数据补名；不写缓存，下次仍可重试。
    return [{ id: folderId, name: '' }]
  }
}
