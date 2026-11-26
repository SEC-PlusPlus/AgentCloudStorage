// Task 8 队列管理器：多文件上传队列（文件级串行、队列并发 1 = 旧 uploadFiles 的 for-await 语义）；
// 单文件编排全部委托 lib/uploads.runUpload（此处只做接线、记账与缓存失效）。
// 模块级 zustand 单例（非 context）：AppLayout（Dock 上传钮/队列面板）与 FilesPage（工具栏/拖放）
// 跨路由树共享同一队列——旧版是 FileWorkbench 页内全局 busy 锁，队列是其多任务替身。
// 批量记账保留旧文案：全部收敛「已上传 N 个文件。」/ 失败沿用旧 uploadFiles catch：中断批次
// （其余文件不再自动跑，行停 queued 等用户重试）+ 原样错误文案。取消文案 W3 中性化为「上传已取消。」
// （旧串对直传小文件是事实错误，spec §1.2-5 有意变更）。
// W3 秒传接线：deps 注入 sha256Hex/instantProbe 真 adapter；命中行=done+instant（批尾 toast 权威、
// 不另弹秒传 toast，队列行内「⚡秒传」徽标见 Attachment）；invalidate/记账复用既有 done 分支，零新路由。
import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  cancelMultipartUpload,
  completeMultipartUpload,
  getMultipartUploadProgress,
  instantProbe,
  startMultipartUpload,
  uploadFile,
  uploadMultipartPart,
} from '@/api/storage'
import { sha256Hex } from '@/lib/crypto'
import { makeLocalStorageUploadStorage, runUpload, type UploadDeps, type UploadTask } from '@/lib/uploads'
import { useAuth } from '@/stores/auth'

interface QueueEntry {
  rowId: string
  file: File
  folderID: number
}

interface UploadManagerState {
  tasks: UploadTask[]
}

const store = create<UploadManagerState>(() => ({ tasks: [] }))

// —— 非渲染态全部放模块闭包（队列/控制器/批次计数与渲染解耦，事件回调里直接可用）——
let configuredQueryClient: QueryClient | null = null
let uploadInput: HTMLInputElement | null = null
let seq = 0
const queue: QueueEntry[] = []
const entries = new Map<string, QueueEntry>()
const controllers = new Map<string, AbortController>()
let activeRowId: string | null = null
let halted = false // 旧语义：本批次出过失败/取消 → 其余文件不再自动跑
let batchUploaded = 0
// T13 carry #12（Task 8 Minor-7）：最近一次 submitFiles 的落点目录（面板头部显目标，不再静默落根）。
// 跨目录混合队列显最近意图——每个任务真实落点仍在 entries 里（重试按原 folderID 跑）。
let lastTargetFolderID = 0

function setTasks(mutate: (prev: UploadTask[]) => UploadTask[]): void {
  store.setState((state) => ({ tasks: mutate(state.tasks) }))
}

function upsertRow(row: UploadTask): void {
  setTasks((prev) => (prev.some((t) => t.id === row.id) ? prev.map((t) => (t.id === row.id ? row : t)) : [...prev, row]))
}

/** 成功失效契约（brief）：['files',…] 前缀覆盖全部分页/目录 + ['usage'] 用量条（旧版是批次尾 refresh() 一次）。 */
function invalidateFileViews(): void {
  configuredQueryClient?.invalidateQueries({ queryKey: ['files'] })
  configuredQueryClient?.invalidateQueries({ queryKey: ['usage'] })
}

function pump(): void {
  if (activeRowId !== null || halted) return
  const entry = queue.shift()
  if (!entry) {
    // 批次自然收敛（无失败/取消）→ 旧版 batch toast「已上传 N 个文件。」（halted 时不报，错误/取消文案已各自出过）
    if (!halted && batchUploaded > 0) toast(`已上传 ${batchUploaded} 个文件。`)
    return
  }
  activeRowId = entry.rowId
  const controller = new AbortController() // 每任务独立信号（plan：per-task AbortController）
  controllers.set(entry.rowId, controller)
  const deps: UploadDeps = {
    uploadFile,
    startMultipart: startMultipartUpload,
    getProgress: getMultipartUploadProgress,
    uploadPart: uploadMultipartPart,
    complete: completeMultipartUpload,
    cancel: cancelMultipartUpload,
    storage: makeLocalStorageUploadStorage(useAuth.getState().user?.id ?? 0), // 旧 savedUploadsKey：acs.multipart.<uid>
    signal: controller.signal,
    // W3 秒传探针真 adapter（薄层不进单测；编排层 fake 覆盖全分支）：
    // 命中 → done+instant 行（无逐条 toast，批尾 toast 权威，差异以行内「⚡秒传」徽标呈现）；
    // 未命中/任何失败 → 编排层静默降级普通直传，用户零双弹。
    sha256Hex,
    instantProbe,
  }
  runUpload(entry.file, entry.folderID, deps, (task) => {
    upsertRow({ ...task, id: entry.rowId }) // 行身份归队列所有；runUpload 的内部 id 在此覆写
    if (task.status === 'done') {
      batchUploaded += 1
      invalidateFileViews()
    }
    if (task.status === 'cancelled') {
      halted = true
      // W3 有意变更（spec §1.2-5）：旧文案「已取消当前大文件上传。」沿用自 uploadFiles:498/507，
      // 对直传小文件（含秒传探针期取消）是事实错误 → 中性化为「上传已取消。」。
      // 钉测：useUploadManager.test.tsx「W3 秒传探针」套件的「探针期间取消」用例。
      toast('上传已取消。')
    }
  })
    .catch((error: unknown) => {
      halted = true // 旧 uploadFiles catch：批次中断，其余文件留 queued（不再静默丢弃——行可见可重试）
      const detail = error instanceof Error ? error.message : String(error)
      // 修复轮 1 / Critical-1 兜底：runUpload 已保证每条 reject 路径 emit failed，此处再防一手
      // 「行冻结 uploading」整类问题——行此刻已不在 queue、controller 已被 finally 清理，
      // 若停在 uploading/merging 则取消/重试双失效、busy 恒真。
      setTasks((prev) =>
        prev.map((t) =>
          t.id === entry.rowId && (t.status === 'uploading' || t.status === 'merging')
            ? { ...t, status: 'failed' as const, error: detail }
            : t,
        ),
      )
      toast.error(batchUploaded > 0 ? `已上传 ${batchUploaded} 个文件，其余失败：${detail}` : detail)
    })
    .finally(() => {
      activeRowId = null
      controllers.delete(entry.rowId)
      pump()
    })
}

/** 入队并尝试开跑。folderID=投放时刻的当前目录（旧 uploadFiles 用 folderID.value 同义）。 */
export function submitFiles(files: File[], folderID: number): void {
  if (files.length === 0) return
  lastTargetFolderID = folderID
  // 修复轮 1 / Important-2：halted 熔断只在「没有正在跑的文件」时被新的用户意图清除——
  // 此前要求队列同时为空，导致批次失败留下 queued 行后、新提交被搁浅永不泵送（queued 行 UI 又无重试入口）。
  // batchUploaded 仍仅在全新批次（队列亦为空）时清零；残留 queued 行随队列原序续跑。
  if (activeRowId === null) {
    halted = false
    if (queue.length === 0) batchUploaded = 0
  }
  const rows: UploadTask[] = files.map((file) => {
    const rowId = `task-${(seq += 1)}`
    const entry: QueueEntry = { rowId, file, folderID } // 保留 File 引用：重试=以同一 File 重跑 runUpload
    entries.set(rowId, entry)
    queue.push(entry)
    return { id: rowId, name: file.name, size: file.size, percent: 0, status: 'queued' as const }
  })
  setTasks((prev) => [...prev, ...rows])
  pump()
}

/**
 * 取消：进行中 → abort 其信号（runUpload 自带「合并阶段忽略取消」，无需在此判状态）；
 * 排队中 → 直接出队置 cancelled。失败/完成/合并中为 no-op。
 */
export function cancelTask(rowId: string): void {
  const controller = controllers.get(rowId)
  if (controller) {
    controller.abort()
    return
  }
  const index = queue.findIndex((entry) => entry.rowId === rowId)
  if (index >= 0) {
    queue.splice(index, 1)
    setTasks((prev) => prev.map((t) => (t.id === rowId ? { ...t, status: 'cancelled' as const } : t)))
  }
}

/** 重试 = 以同一 File 重跑 runUpload：failed/cancelled 行复位 queued 重新入队（串行由 pump 自然调度），并解批次熔断。 */
export function retryTask(rowId: string): void {
  const entry = entries.get(rowId)
  if (!entry) return
  const row = store.getState().tasks.find((t) => t.id === rowId)
  if (!row || (row.status !== 'failed' && row.status !== 'cancelled')) return
  setTasks((prev) => prev.map((t) => (t.id === rowId ? { ...t, status: 'queued' as const, percent: 0, error: undefined } : t)))
  halted = false
  queue.push(entry)
  pump()
}

/** 由 UploadQueuePanel 挂载隐藏 input；Dock/工具栏入口统一 openPicker 触发它（旧 toolbar 同款 input 方案）。 */
export function setUploadInput(el: HTMLInputElement | null): void {
  uploadInput = el
}

export function openPicker(): void {
  uploadInput?.click()
}

export interface UploadManagerView {
  tasks: UploadTask[]
  /** 队列正在搬运文件（旧 busy 的等价，供入口禁用；queued 滞留不算 busy——失败熔断后仍可点重试/再投）。 */
  busy: boolean
  /** T13 carry #12：最近一次 submitFiles 的落点目录 id（UploadQueuePanel 头部显「保存到：…」用）。 */
  lastTargetFolderID: number
  submitFiles(files: File[], folderID: number): void
  cancelTask(rowId: string): void
  retryTask(rowId: string): void
  openPicker(): void
}

/** 消费入口。必须在 QueryClientProvider 内使用（成功失效依赖注入的 client）。 */
export function useUploadManager(): UploadManagerView {
  const queryClient = useQueryClient()
  useEffect(() => {
    configuredQueryClient = queryClient
  }, [queryClient])
  const tasks = store((state) => state.tasks)
  const busy = tasks.some((t) => t.status === 'uploading' || t.status === 'merging')
  return { tasks, busy, lastTargetFolderID, submitFiles, cancelTask, retryTask, openPicker }
}

/** 仅测试用：复位模块单例（vitest 同文件内无模块隔离；业务代码禁止调用）。 */
export function resetUploadManager(): void {
  queue.length = 0
  entries.clear()
  controllers.clear()
  activeRowId = null
  halted = false
  batchUploaded = 0
  lastTargetFolderID = 0
  configuredQueryClient = null
  uploadInput = null
  seq = 0
  store.setState({ tasks: [] })
}
