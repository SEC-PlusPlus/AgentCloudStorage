// Task 8：上传编排纯逻辑 —— 旧 Vue FileWorkbench.vue:457-558（历史提交 adbcfba）uploadFiles/uploadLargeFile
// 逐分支移植为可注入函数，全部网络/存储/信号依赖经 UploadDeps 注入（零真实 fetch、零 localStorage 依赖，可全 fake 测试）。
// 原样保留的旧语义：
// ① 阈值 `file.size >= 49MiB` 走 multipart，否则直传（旧 497 行，>= 非 >）；
// ② 续传匹配四字段 name/size/lastModified/folderID + expiresAt 未过期（旧 512-514）；
// ③ progress.status 2=正在恢复合并→直接 complete+forget / 3=forget+收敛（旧版即不再上传该文件，忠实移植）/
//    4=forget 后全新 start / 其余=续传（uploaded_parts 去重）（旧 516-533）；
// ④ 进度探测仅 404/409 → forget+重开（Review Focus #2），其他错误原样上抛（旧 534-536）；
// ⑤ 合并阶段不可取消（旧 cancelCurrentUpload:544 status 含「合并」直接 return 的等价：complete 前后不读信号）；
// ⑥ 取消 → cancelMultipartUpload + forget（旧 552-556）；失败抛原始 ApiError 且续传记录保留（Review Focus #5）。
// 控制端裁定的改动（plan Task 8）：分片循环由顺序 await 改为并发（默认 3），已传集合去重、
// 任一失败整任务 reject、记录留可续传；全局 cancelRequested/uploadAbort 改为每任务 AbortSignal（检查点同旧版）。
import { ApiError } from '@/api/client'
import type { MultipartUploadProgress, MultipartUploadSession } from '@/api/storage'

/** 旧 497 行：`file.size >= 49 * 1024 * 1024` 走 multipart（为 multipart/form-data 封框留余量，后端 50MiB 上限）。 */
export const MULTIPART_THRESHOLD_BYTES = 49 * 1024 * 1024
/** 分片并发数默认 3（旧版为 1 顺序；plan Task 8 裁定提速但不改可观测结果）。 */
export const DEFAULT_PART_CONCURRENCY = 3

/** localStorage `acs.multipart.<uid>` 存储记录 —— 形状与旧 508 行 SavedUpload 逐字段一致。 */
export interface SavedUpload {
  id: string
  name: string
  size: number
  lastModified: number
  folderID: number
  expiresAt: string
}

export type UploadTaskStatus = 'queued' | 'uploading' | 'merging' | 'done' | 'failed' | 'cancelled'

export interface UploadTask {
  id: string
  name: string
  size: number
  percent: number
  status: UploadTaskStatus
  error?: string
}

export interface UploadStorage {
  read(): SavedUpload[]
  save(record: SavedUpload): void
  forget(id: string): void
}

export interface UploadDeps {
  uploadFile(file: File, folderID: number): Promise<unknown>
  startMultipart(file: File, folderID: number): Promise<MultipartUploadSession>
  getProgress(id: string): Promise<MultipartUploadProgress>
  uploadPart(id: string, partNumber: number, part: Blob, signal: AbortSignal): Promise<unknown>
  complete(id: string): Promise<unknown>
  cancel(id: string): Promise<unknown>
  storage: UploadStorage
  signal: AbortSignal
  partConcurrency?: number
}

/** 任务 id：仅编排内部标识（队列层以自己的行 id 覆写，见 useUploadManager）。不用 crypto.randomUUID——jsdom 版本敏感。 */
let taskSeq = 0
function nextTaskId(): string {
  taskSeq += 1
  return `upload-${Date.now().toString(36)}-${taskSeq.toString(36)}`
}

function abortError(): DOMException {
  return new DOMException('Upload cancelled', 'AbortError') // 旧 543 行同款异常
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function totalPartsOf(size: number, partSize: number): number {
  return Math.ceil(size / partSize)
}

function partPercent(uploaded: number, total: number): number {
  if (total <= 0) return 100
  return Math.min(100, Math.floor((uploaded / total) * 100)) // 旧 calculatePercent:541
}

/**
 * 旧 savedUploadsKey/readSavedUploads/saveUpload/forgetUpload（509-518 行）的 localStorage 实现。
 * 键名 `acs.multipart.<uid>` 与旧版逐字节一致（uid=auth.user.id，缺省 0）。解析失败按空集合兜底（旧 catch 同款）。
 */
export function makeLocalStorageUploadStorage(uid: number | string): UploadStorage {
  const key = `acs.multipart.${uid}`
  const read = (): SavedUpload[] => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as SavedUpload[] // 理由：localStorage 值无静态形状，按记录约定收窄
    } catch {
      return []
    }
  }
  return {
    read,
    save: (record) => {
      const records = read().filter((item) => item.id !== record.id)
      records.push(record)
      localStorage.setItem(key, JSON.stringify(records))
    },
    forget: (id) => {
      localStorage.setItem(key, JSON.stringify(read().filter((item) => item.id !== id)))
    },
  }
}

/**
 * 单文件上传编排（旧 uploadFiles 循环体 + uploadLargeFile 全分支）。
 * 收敛约定：done/cancelled 走 resolve；仅真失败 reject 原始 ApiError（旧版经 uploadFiles catch 上抛的等价）。
 * cancelled 的 UI 播报（toast「已取消当前大文件上传。」）与批量记账在队列层（useUploadManager），此处纯逻辑。
 */
export async function runUpload(
  file: File,
  folderID: number,
  deps: UploadDeps,
  onTask: (task: UploadTask) => void,
): Promise<void> {
  let last: UploadTask = { id: nextTaskId(), name: file.name, size: file.size, percent: 0, status: 'queued' }
  const emit = (patch: Partial<UploadTask>): void => {
    last = { ...last, ...patch }
    onTask({ ...last }) // 拷贝外发：调用方持有快照，不受后续内部更新影响
  }

  // —— 直传路径（旧 497-499 行的 else 分支）：单请求，旧版无中止通道（uploadAbort 仅分片流持有），原样移植 ——
  if (file.size < MULTIPART_THRESHOLD_BYTES) {
    emit({ status: 'uploading' })
    try {
      await deps.uploadFile(file, folderID)
    } catch (error) {
      emit({ status: 'failed', error: messageOf(error) })
      throw error // 失败抛原始 ApiError（413/507 文案由 client 的 status-first 分支保证）
    }
    emit({ status: 'done', percent: 100 })
    return
  }

  // —— multipart 路径（旧 uploadLargeFile:511-558）——
  emit({ status: 'uploading' }) // 旧 status「准备上传」
  const matches = (record: SavedUpload): boolean =>
    record.name === file.name &&
    record.size === file.size &&
    record.lastModified === file.lastModified &&
    record.folderID === folderID
  const previous = deps.storage.read().find(matches)

  let session: MultipartUploadSession | undefined
  const uploadedParts = new Set<number>()

  if (previous && Date.parse(previous.expiresAt) > Date.now()) {
    try {
      const progress = await deps.getProgress(previous.id)
      if (progress.status === 2) {
        // 「正在恢复合并」：合并阶段禁断 → 此分支全程不读信号（旧 516-521）
        emit({ status: 'merging' })
        await deps.complete(previous.id)
        deps.storage.forget(previous.id)
        emit({ status: 'done', percent: 100 })
        return
      }
      if (progress.status === 3) {
        // 忠实移植旧 523-526：forget + return（文件实际未上传，旧版按批次「已完成」收敛，行为等价保留）
        deps.storage.forget(previous.id)
        emit({ status: 'done', percent: 100 })
        return
      }
      if (progress.status === 4) {
        deps.storage.forget(previous.id) // forget 后落入下方「if (!session) start」全新开
      } else {
        session = { id: progress.id, part_size: progress.part_size, expires_at: progress.expires_at }
        for (const n of progress.uploaded_parts) uploadedParts.add(n)
        emit({ percent: partPercent(uploadedParts.size, totalPartsOf(file.size, session.part_size)) }) // 「续传中 · 已确认 x/y」→ percent 快照
      }
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 409)) throw error
      deps.storage.forget(previous.id) // Review Focus #2：仅 404/409 forget，重开全新会话
    }
    if (!session) session = await deps.startMultipart(file, folderID)
  } else {
    if (previous) deps.storage.forget(previous.id) // 过期记录清理（旧 537）
    session = await deps.startMultipart(file, folderID)
  }

  const active = session
  deps.storage.save({
    id: active.id,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    folderID,
    expiresAt: active.expires_at,
  })
  const total = totalPartsOf(file.size, active.part_size)

  // 分片并发池：pending = 1..total 减去已确认集合（去重续传）；worker 每轮取号前读信号，
  // 任一失败整任务 reject（Promise.all 首败即出），已传分片留在服务端 + 记录未 forget → 重试续传。
  const runParts = async (): Promise<void> => {
    const pending: number[] = []
    for (let n = 1; n <= total; n++) {
      if (!uploadedParts.has(n)) pending.push(n)
    }
    emit({ percent: partPercent(uploadedParts.size, total) })
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        if (deps.signal.aborted) throw abortError() // 旧循环首行 cancelRequested 检查的并发等价
        const n = pending[cursor]
        if (n === undefined) return
        cursor += 1
        const start = (n - 1) * active.part_size
        const part = file.slice(start, Math.min(start + active.part_size, file.size))
        await deps.uploadPart(active.id, n, part, deps.signal)
        uploadedParts.add(n)
        emit({ percent: partPercent(uploadedParts.size, total) }) // 旧 546-547「已确认 x/y」→ percent 单调
      }
    }
    const lanes = Math.max(1, Math.min(deps.partConcurrency ?? DEFAULT_PART_CONCURRENCY, pending.length))
    await Promise.all(Array.from({ length: lanes }, () => worker()))
  }

  try {
    if (deps.signal.aborted) throw abortError() // 旧 save 记录后第一处检查（539）
    await runParts()
    if (deps.signal.aborted) throw abortError() // 旧 complete 前第二处检查（548）；此后进入合并阶段，信号不再被读取
    emit({ status: 'merging' }) // 「正在合并文件」
    await deps.complete(active.id) // 合并阶段不可取消（旧 544）：abort 到达也等它跑完
    deps.storage.forget(active.id)
    emit({ status: 'done', percent: 100 })
  } catch (error) {
    if (deps.signal.aborted) {
      // 取消分支（旧 552-556）：cancelMultipartUpload + forget，任务以 cancelled 收敛（不 reject）。
      // 旧版 cancel 接口失败仅覆盖 errorMessage——此处等价：吞掉 cancel 错误仍 forget。
      emit({ status: 'cancelled' })
      try {
        await deps.cancel(active.id)
      } catch {
        /* 取消接口失败：记录照常 forget，服务端会话由过期自清 */
      }
      deps.storage.forget(active.id)
      return
    }
    // 真失败：抛原始 ApiError、记录保留（不 forget）——重试/重选文件即从 uploaded_parts 续传（Review Focus #5）
    emit({ status: 'failed', error: messageOf(error) })
    throw error
  }
}
