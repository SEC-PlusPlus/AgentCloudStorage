// Task 9 文件操作失效键（brief Interfaces 钉死形状）。
// 设计：旧 FileWorkbench 每个操作后 refresh() 全量重取 folders+files+usage；React 版按动作精确到
// 「目录族键」——['folders',id]/['files',id] 为前缀（files 键带 page 后缀，一次失效覆盖该目录全部页，
// 与 useFileRows 的 ['files',f,p] / crumbs BFS 的 ['folders',parentId] 键契约同源）。
// rename/move/trash 会影响任意关键词的 ['search',q,p] 行与 ['navTrail',id] 链缓存（文件夹改名/挪动
// 使各级面包屑名过期），但 action 形状不带关键词与链 id——族级前缀 ['search']/['navTrail'] 是唯一
// 可表达的粒度；navTrail 查询 queryFn 自带缓存 fast-path + 60s 自愈（TopBar 注释），族失效无请求风暴。
// trash 型同时覆盖 deleteFolder（旧版对空目录删除的确认文案同走此通道，后端「非空文件夹」限制文案
// 由 translateError 呈现）；['usage'] 在 trash/move/restore/perm-delete 在场=旧 refresh 语义
// （move/restore 实际不改用量，brief 钉 move 含 usage——冗余但无害的保鲜）。
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { ApiError } from '@/api/client'

export type FileActionType = 'create-folder' | 'rename' | 'move' | 'trash' | 'restore' | 'perm-delete'

export interface FileAction {
  type: FileActionType
  /** 动作发生/来源目录；省略 = 调用方当前目录（currentFolder 兜底）。 */
  fromFolder?: number
  /** 目标目录：move 的落点、restore 的回放点。 */
  toFolder?: number
}

/** 族级前缀键（无 id 参数 = 整族失效）。 */
const SEARCH: QueryKey = ['search']
const TRASH: QueryKey = ['trash']
const NAV_TRAIL: QueryKey = ['navTrail']
const USAGE: QueryKey = ['usage']

const folderKeys = (id: number): QueryKey[] => [['folders', id], ['files', id]]

/**
 * 纯函数：给定动作与当前目录，返回需要 invalidate 的 query 键数组（精确序、已去重）。
 * - create-folder：源目录 folders+files（brief Step 1 钉）
 * - rename：源目录双列表 + ['search'] + ['navTrail']
 * - move：源与目标目录 key + navTrail + usage（**Review Focus #4**，brief Step 1 钉）
 * - trash：源目录双列表 + ['search'] + ['trash'] + usage（brief Step 1 钉 usage）
 * - restore：目标目录 files + ['search'] + ['trash'] + usage
 * - perm-delete：['trash'] + usage
 */
export function computeInvalidations(action: FileAction, currentFolder: number): QueryKey[] {
  const from = action.fromFolder ?? currentFolder
  const to = action.toFolder ?? from
  switch (action.type) {
    case 'create-folder':
      return folderKeys(from)
    case 'rename':
      return [...folderKeys(from), SEARCH, NAV_TRAIL]
    case 'move':
      return dedupeKeys([...folderKeys(from), ...folderKeys(to), SEARCH, NAV_TRAIL, USAGE])
    case 'trash':
      return [...folderKeys(from), SEARCH, TRASH, USAGE]
    case 'restore':
      return [['files', to], SEARCH, TRASH, USAGE]
    case 'perm-delete':
      return [TRASH, USAGE]
  }
}

/** 按 JSON 形态去重（move 源=目标时键重复；键内容恒为 string|number 浅数组，可安全序列化）。 */
function dedupeKeys(keys: QueryKey[]): QueryKey[] {
  const seen = new Set<string>()
  return keys.filter((key) => {
    const id = JSON.stringify(key)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** 失效执行器：数组逐个喂 invalidateQueries（前缀匹配语义由 TanStack 兑现）。 */
export function applyInvalidations(queryClient: QueryClient, keys: QueryKey[]): void {
  for (const key of keys) queryClient.invalidateQueries({ queryKey: key })
}

/**
 * 错误呈现统一入口：ApiError.message 已是 translateError 中文映射，原样透传
 * （非空文件夹/自嵌移动等限制文案「全部交后端+中文映射」，前端不预判）；
 * 非 ApiError（网络层外意外）兜底旧 FileWorkbench apiMessage 的固定文案。
 */
export function mutationErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请稍后重试。'
}
