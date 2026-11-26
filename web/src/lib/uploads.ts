// Task 8：上传编排纯逻辑 —— 旧 Vue FileWorkbench.vue:457-558（历史提交 adbcfba）uploadFiles/uploadLargeFile
// 逐分支移植为可注入函数，全部网络/存储/信号依赖经 UploadDeps 注入（零真实 fetch、零 localStorage 依赖，可全 fake 测试）。
// 原样保留的旧语义：
// ① 阈值 `file.size >= 49MiB` 走 multipart，否则直传（旧 497 行，>= 非 >）；
// ② 续传匹配四字段 name/size/lastModified/folderID + expiresAt 未过期（旧 512-514）；
// ③ progress.status 2=正在恢复合并→直接 complete+forget / 3=已完成（StatusCompleted，文件已由服务端合并；
//    修复轮 1 / Minor-5 勘误旧注释「未上传」之误）/ 4=forget 后全新 start / 其余=续传（uploaded_parts 去重）（旧 516-533）；
// ④ 进度探测仅 404/409 → forget+重开（Review Focus #2），其他错误原样上抛（旧 534-536）；
// ⑤ 合并阶段不可取消（旧 cancelCurrentUpload:544 status 含「合并」直接 return 的等价：complete 前后不读信号）；
// ⑥ 取消 → cancelMultipartUpload + forget（旧 552-556）；失败抛原始 ApiError 且续传记录保留（Review Focus #5）。
// 控制端裁定的改动（plan Task 8）：分片循环由顺序 await 改为并发（默认 3），已传集合去重、
// 任一失败整任务 reject、记录留可续传；全局 cancelRequested/uploadAbort 改为每任务 AbortSignal。
// 修复轮 1（评审 Critical-1 / Important-3）：
// · 外层 wrapper 统一为**每条** reject 路径 emit failed（含 status-2 恢复合并的 complete、进度探测
//   非 404/409、startMultipart 三处预-loop 抛出——旧移植此处不发声，队列行冻结「上传中」、busy 恒真）；
// · 分片失败广播：内部 AbortController 中继 deps.signal 传入 uploadPart，首个真失败即掐兄弟 lane
//   在途请求并静默终止其后续拉取；lane 全部停稳（allSettled）后才上抛，failed 之后不再有 percent emission。
// W3（秒传探针接线，spec §1.2）：仅 <49MiB 直传分支前置「arrayBuffer → sha256Hex → instantProbe」探针段——
// 命中(201)→ done + instant=true（零字节，uploadFile 绝不调用）；未命中/任何失败/旧环境无 subtle → 静默降级，
// 既有直传流程逐字段不变；探针期间任务保持 queued 0%（不新增状态），取消并入既有 cancelled 分支。
// 分片（≥49MiB）路径零改动。sha256Hex/instantProbe 为 UploadDeps 注入点（真实 adapter 不进单测，家规同 Task 8）。
import { ApiError } from '@/api/client'
import {
  INSTANT_PROBE_TIMEOUT_MS,
  type InstantProbeInput,
  type MultipartUploadProgress,
  type MultipartUploadSession,
} from '@/api/storage'

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
  /** W3：该任务经秒传探针命中（服务端零字节建账）。队列行内「⚡秒传」徽标据此渲染（spec §1.2）。 */
  instant?: boolean
}

/** 探针裁决（spec §2 deps 契约）：linked=201 命中 / miss=200 未命中。其余 HTTP 失败面以 throw 表达。 */
export type InstantProbeResult = 'linked' | 'miss'

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
  // W3 秒传探针注入点（spec §1.2/§2）：编排逻辑纯 fake 可测，真实实现见 lib/crypto.ts 与 api/storage.ts
  // （薄 adapter 不进单测的家规沿 Task 8「零真网络」惯例）。
  /** 对直传文件的完整字节做 SHA-256 hex。失败（无 subtle 的旧环境/内存拒绝）由探针段 catch 吞掉降级。 */
  sha256Hex(buffer: ArrayBuffer): Promise<string>
  /** POST /files/instant。201→'linked'（零字节入账）；200 {exists:false}→'miss'；其余 throw（同样降级）。 */
  instantProbe(input: InstantProbeInput): Promise<InstantProbeResult>
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

/**
 * W3：把探针段的每个 await 点包进 abort 竞速——signal 触发即 reject，取消**立刻**收敛 cancelled，
 * 不必等 arrayBuffer/sha256Hex/instantProbe 承诺自然落定（49MiB 哈希可达秒级，探针是网络请求）。
 * 被弃置的内层 promise 结果一律丢弃；监听器带 once + 完成后摘除，无泄漏。
 */
async function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    const detach = (): void => signal.removeEventListener('abort', onAbort)
    promise.then(
      (value) => { detach(); resolve(value) },
      (error) => { detach(); reject(error) },
    )
  })
}

/**
 * RF1（评审修复轮 1）：探针网络段封顶竞速——instantProbe 永不落定（网络黑洞/DB 卡死，
 * 或 dep 实现漏了自带超时）时于 INSTANT_PROBE_TIMEOUT_MS 强制 reject → 汇入既有探针 catch
 * 静默降级直传（deps.signal 未 abort ⇒ 不误入 cancelled 分支），队列绝不再被挂死的探针钉在 queued 0%。
 * 与 api/storage.ts 真 adapter 的 AbortSignal.timeout 同值双保险；正常落定即摘表，不残留计时器。
 */
function withinProbeWindow<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('instant probe timed out')), INSTANT_PROBE_TIMEOUT_MS)
    const detach = (): void => clearTimeout(timer)
    promise.then(
      (value) => { detach(); resolve(value) },
      (error) => { detach(); reject(error) },
    )
  })
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
 * 收敛约定：done/cancelled 走 resolve；reject 仅限真失败，且外层统一先 emit failed（修复轮 1 / Critical-1）。
 * cancelled 的 UI 播报（toast「上传已取消。」——W3 起新文案，spec §1.2-5）与批量记账在队列层
 * （useUploadManager），此处纯逻辑。
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

  const orchestrate = async (): Promise<void> => {
    // —— 直传路径（旧 497-499 行的 else 分支）+ W3 秒传探针前置（spec §1.2）——
    // 仅 fresh 直传探针：SavedUpload 续传语义只存在于分片通道（直传本就无存储记录，旧版如此），
    // 故「resume 跳过探针」在此天然成立——若任务曾中断，恢复走的是分片分支的服务端会话，不重叠。
    // 探针期间任务保持 queued 0%（builder-check：不新增状态）；signal 检查在 digest 前后各一次，
    // 期间取消 → 既有 cancelled 收敛（不 reject、不发任何后续 dep）。
    if (file.size < MULTIPART_THRESHOLD_BYTES) {
      if (deps.signal.aborted) {
        emit({ status: 'cancelled' })
        return
      }
      let linked = false
      try {
        const buffer = await untilAborted(file.arrayBuffer(), deps.signal)
        if (deps.signal.aborted) {
          emit({ status: 'cancelled' })
          return
        }
        const sha256 = await untilAborted(deps.sha256Hex(buffer), deps.signal)
        if (deps.signal.aborted) {
          emit({ status: 'cancelled' }) // digest 后即取消（检查点之二）：探针不再发起
          return
        }
        const result = await untilAborted(
          withinProbeWindow( // RF1：探针 3s 封顶，永不落定=静默降级（abort 取消时残留计时器≤3s 自熄，无害）
            deps.instantProbe({
              sha256,
              original_name: file.name,
              content_type: file.type || 'application/octet-stream', // startMultipartUpload 同款兜底
              folder_id: folderID,
            }),
          ),
          deps.signal,
        )
        if (deps.signal.aborted) {
          emit({ status: 'cancelled' }) // 探针在途取消：迟到的 201 也不再动行（取消语义优先）
          return
        }
        linked = result === 'linked'
      } catch (error) {
        // 哈希/探针任何失败（无 subtle / 内存拒绝 / 401/404/409/507/网络 / 形状异常 / RF1 超时）与
        // untilAborted 掐出的 AbortError 都汇到这里：signal 优先判取消，否则静默降级直传
        // （spec §1.2-2：配额/登录错误面由随后的 uploadFile 原样复现，用户零双弹）。
        if (deps.signal.aborted) {
          emit({ status: 'cancelled' })
          return
        }
        // MINOR-2（评审修复轮 1）：降级对用户绝对静默，但 DEV 下留痕——否则生产旁路排查时
        // 「秒传从未命中」与「环境无 subtle」不可区分。仅 console.debug，UI/测试断言零影响。
        if (import.meta.env.DEV) console.debug('instant probe degraded', error)
      }
      if (linked) {
        emit({ status: 'done', percent: 100, instant: true }) // 命中=零字节完成（批尾 toast 权威，此处不弹）
        return
      }
      emit({ status: 'uploading' }) // 未命中/降级：以下直传流程与旧行为逐字段一致
      await deps.uploadFile(file, folderID)
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
          // 「正在恢复合并」：合并阶段禁断 → 此分支全程不读信号（旧 516-521）。
          // complete 抛错（如分片不全 400）原样上抛，由外层 emit failed（修复轮 1 / Critical-1 三处之一）。
          emit({ status: 'merging' })
          await deps.complete(previous.id)
          deps.storage.forget(previous.id)
          emit({ status: 'done', percent: 100 })
          return
        }
        if (progress.status === 3) {
          // 修复轮 1 / Minor-5 勘误：status 3 = StatusCompleted——文件已由服务端**完成合并**，
          // 旧版 523-526 的 forget+return（不再重复上传）本来就是正确行为，非「文件未上传」的怪癖。
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
      // 预-loop 抛出点之二/之三：startMultipart 失败（507 配额等）→ 外层 failed，不落记录、不传分片
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

    // 分片并发池（修复轮 1 / Important-3）：
    // 内部 partController = deps.signal 的中继 + 首败广播通道；uploadPart 一律收内部信号，
    // 真失败由首个 lane 广播 abort：兄弟 lane 在途请求被掐、循环顶见到即静默返回（不再拉新分片、
    // 不再 emit）。Promise.allSettled 等全部 lane 停稳后才带上抛 → failed 之后绝无残留 percent emission。
    const runParts = async (): Promise<void> => {
      const pending: number[] = []
      for (let n = 1; n <= total; n++) {
        if (!uploadedParts.has(n)) pending.push(n)
      }
      const percent = (): number => partPercent(uploadedParts.size, total)
      emit({ percent: percent() })
      const partController = new AbortController()
      const relay = (): void => partController.abort()
      deps.signal.addEventListener('abort', relay)
      if (deps.signal.aborted) relay() // 入池前已取消的兜底（外层检查点在前，双保险）
      let cursor = 0
      const worker = async (): Promise<void> => {
        for (;;) {
          if (deps.signal.aborted) throw abortError() // 用户取消 → 下方 catch 走 cancel 收敛（旧循环首行检查等价）
          if (partController.signal.aborted) return // 兄弟首败广播 → 静默退场（Important-3）
          const n = pending[cursor]
          if (n === undefined) return
          cursor += 1
          const start = (n - 1) * active.part_size
          const part = file.slice(start, Math.min(start + active.part_size, file.size)) // 尾片截到 file.size（Important-4 测试钉死偏移/大小）
          try {
            await deps.uploadPart(active.id, n, part, partController.signal)
          } catch (error) {
            if (deps.signal.aborted) throw abortError() // 取消掐出的 AbortError → cancel 收敛路径
            if (partController.signal.aborted) return // 在途片被首败广播掐掉 → 静默（原始错误由肇事 lane 上报）
            partController.abort() // 首个真失败：广播停摆所有 lane
            throw error // 原始 ApiError → allSettled 汇总后上抛 → 外层 failed，记录保留可续传（Review Focus #5）
          }
          uploadedParts.add(n)
          emit({ percent: percent() }) // 旧 546-547「已确认 x/y」→ percent 单调
        }
      }
      const lanes = Math.max(1, Math.min(deps.partConcurrency ?? DEFAULT_PART_CONCURRENCY, pending.length))
      try {
        const settled = await Promise.allSettled(Array.from({ length: lanes }, () => worker()))
        const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failure) throw failure.reason // 多 lane 同败取首个 rejection（整任务 reject 原始错误语义不变）
      } finally {
        deps.signal.removeEventListener('abort', relay)
      }
    }

    try {
      if (deps.signal.aborted) throw abortError() // 旧 save 记录后第一处检查（539）
      await runParts()
      if (deps.signal.aborted) throw abortError() // 旧 complete 前第二处检查（548）
      emit({ status: 'merging' }) // 「正在合并文件」——此后信号不再被读取（旧 544「合并禁断」，用例⑥）
      await deps.complete(active.id)
      deps.storage.forget(active.id)
      emit({ status: 'done', percent: 100 })
    } catch (error) {
      if (deps.signal.aborted) {
        // 取消分支（旧 552-556）：emit cancelled + cancelMultipartUpload + forget，任务以 cancelled 收敛（不 reject）。
        // 修复轮 1 / Minor-8 勘误：**有意偏离**旧版的无条件 forget——旧版把 forget 放在 cancel 的 try 块内，
        // cancel 接口失败时记录会残留；原注释声称等价是错的。偏离保留的理由：残留记录反而挡住重新上传，
        // 自愈统一交给续传时进度探测 404/409 → forget+重开（分支④ / Review Focus #2）路径承担。
        emit({ status: 'cancelled' })
        try {
          await deps.cancel(active.id)
        } catch {
          /* cancel 接口失败：不再上抛——已广播取消，任务语义即 cancelled */
        }
        deps.storage.forget(active.id)
        return
      }
      throw error // 真失败：由外层 wrapper 统一 emit failed + 原样上抛
    }
  }

  // 修复轮 1 / Critical-1：所有逃逸出 orchestrate 的 rejection（直传失败、进度探测非 404/409、
  // status-2 恢复合并的 complete、startMultipart、分片失败、合并失败）都先以 failed 行收敛再原样上抛。
  // cancelled 在上一步已内部收敛（resolve），不会走到这里。
  try {
    await orchestrate()
  } catch (error) {
    emit({ status: 'failed', error: messageOf(error) })
    throw error
  }
}
