// Task 8 Step 1：上传编排纯逻辑行为锚（brief 7 用例全覆盖，全部注入 fake deps，零网络/零 localStorage）。
// 旧语义逐项钉死（FileWorkbench.vue:457-558 @adbcfba）：≥49MiB 阈值分流、续传四字段匹配、
// progress.status 2/3/4 分支、404/409 forget+全新 start（Review Focus #2，其余 status 原样上抛）、
// 合并阶段忽略取消、取消 cancel+forget、失败抛原始 ApiError 且续传记录保留（Review Focus #5）。
// 新语义：分片并发（默认 3）不改变「uploadPart 调用次数 = total − uploaded」等可观测结果。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import {
  MULTIPART_THRESHOLD_BYTES,
  runUpload,
  type SavedUpload,
  type UploadDeps,
  type UploadTask,
} from '@/lib/uploads'
import type { MultipartUploadProgress, MultipartUploadSession } from '@/api/storage'

const MiB = 1024 * 1024
const BIG_SIZE = 49 * MiB // 阈值即分片：file.size >= 49MiB（旧 497 行 >=）
const PART_SIZE = 8 * MiB // → ceil(49/8) = 7 片，非整除尾片更贴近真实
const TOTAL_PARTS = Math.ceil(BIG_SIZE / PART_SIZE)
const NAME = 'big.bin'
const LAST_MODIFIED = 1700000000000
const FOLDER = 3
const FAR_FUTURE = '2099-01-01T00:00:00Z'

/** 无头环境不依赖真 Blob：runUpload 只读 name/size/lastModified 与 slice() 边界。 */
function makeFile(size: number, name = NAME, lastModified = LAST_MODIFIED): File {
  return {
    name,
    size,
    lastModified,
    type: 'application/octet-stream',
    slice: (start?: number, end?: number) => {
      const s = start ?? 0
      const e = end ?? size
      return { size: e - s } as unknown as Blob
    },
  } as unknown as File
}

function bigFile(): File {
  return makeFile(BIG_SIZE)
}

interface Harness {
  deps: UploadDeps
  controller: AbortController
  tasks: UploadTask[]
  records: SavedUpload[]
  session: MultipartUploadSession
  progress: MultipartUploadProgress
  run: (file?: File, folderID?: number, onTaskExtra?: (t: UploadTask) => void) => Promise<void>
}

function createHarness(overrides: Partial<UploadDeps> = {}): Harness {
  const controller = new AbortController()
  const records: SavedUpload[] = []
  const tasks: UploadTask[] = []
  const session: MultipartUploadSession = { id: 'up-1', part_size: PART_SIZE, expires_at: FAR_FUTURE }
  const progress: MultipartUploadProgress = {
    id: 'up-1',
    status: 1,
    size: BIG_SIZE,
    part_size: PART_SIZE,
    total_parts: TOTAL_PARTS,
    uploaded_parts: [],
    expires_at: FAR_FUTURE,
  }
  const deps: UploadDeps = {
    uploadFile: vi.fn(async () => ({ id: 1 })),
    startMultipart: vi.fn(async () => session),
    getProgress: vi.fn(async () => progress),
    uploadPart: vi.fn(async () => undefined),
    complete: vi.fn(async () => ({ id: 1 })),
    cancel: vi.fn(async () => undefined),
    storage: {
      read: vi.fn(() => records.slice()),
      save: vi.fn((record: SavedUpload) => {
        const i = records.findIndex((item) => item.id === record.id)
        if (i >= 0) records.splice(i, 1)
        records.push(record)
      }),
      forget: vi.fn((id: string) => {
        const i = records.findIndex((item) => item.id === id)
        if (i >= 0) records.splice(i, 1)
      }),
    },
    signal: controller.signal,
    ...overrides,
  }
  const onTask = (t: UploadTask) => {
    tasks.push(t)
  }
  return {
    deps,
    controller,
    tasks,
    records,
    session,
    progress,
    run: (file = bigFile(), folderID = FOLDER, extra) =>
      runUpload(file, folderID, deps, (t) => {
        onTask(t)
        extra?.(t)
      }),
  }
}

function seedPrevious(h: Harness, overrides: Partial<SavedUpload> = {}): SavedUpload {
  const record: SavedUpload = {
    id: 'up-1',
    name: NAME,
    size: BIG_SIZE,
    lastModified: LAST_MODIFIED,
    folderID: FOLDER,
    expiresAt: FAR_FUTURE,
    ...overrides,
  }
  h.records.push(record)
  return record
}

function partNumbers(h: Harness): number[] {
  const calls = h.deps.uploadPart as ReturnType<typeof vi.fn>
  return calls.mock.calls.map((call) => call[1] as number)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runUpload：阈值分流与直传（用例①）', () => {
  it('<49MiB 走 uploadFile 直传，不碰分片与续传记录，percent 100/done', async () => {
    const h = createHarness()
    await h.run(makeFile(MULTIPART_THRESHOLD_BYTES - 1))
    expect(h.deps.uploadFile).toHaveBeenCalledTimes(1)
    expect(h.deps.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: NAME }), FOLDER)
    expect(h.deps.startMultipart).not.toHaveBeenCalled()
    expect(h.deps.getProgress).not.toHaveBeenCalled()
    expect(h.deps.complete).not.toHaveBeenCalled()
    expect(h.deps.storage.read).not.toHaveBeenCalled()
    expect(h.deps.storage.save).not.toHaveBeenCalled()
    expect(h.deps.storage.forget).not.toHaveBeenCalled()
    expect(h.tasks[0]).toMatchObject({ status: 'uploading', percent: 0 })
    expect(h.tasks.at(-1)).toMatchObject({ status: 'done', percent: 100 })
  })

  it('阈值精确 49MiB 走分片（旧 497 行为 >=，非 >）', async () => {
    const h = createHarness()
    await h.run(makeFile(MULTIPART_THRESHOLD_BYTES))
    expect(h.deps.uploadFile).not.toHaveBeenCalled()
    expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
  })

  it('直传 413 → reject 原始 ApiError、task failed、不动续传记录', async () => {
    const err = new ApiError('文件过大，单次上传约支持 50 MiB 以内的文件。', 413)
    const h = createHarness({ uploadFile: vi.fn(async () => { throw err }) })
    await expect(h.run(makeFile(MiB))).rejects.toBe(err)
    const last = h.tasks.at(-1)
    expect(last).toMatchObject({ status: 'failed', error: '文件过大，单次上传约支持 50 MiB 以内的文件。' })
    expect(h.deps.storage.forget).not.toHaveBeenCalled()
  })
})

describe('runUpload：全新完整 multipart 流程（用例②）', () => {
  it('start→分片→complete→forget；percent 单调；记录先 save 后 forget', async () => {
    const h = createHarness()
    await h.run()

    expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
    expect(h.deps.getProgress).not.toHaveBeenCalled() // 无历史记录不发进度探测
    expect(partNumbers(h)).toHaveLength(TOTAL_PARTS)
    expect(new Set(partNumbers(h))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))
    const partCalls = (h.deps.uploadPart as ReturnType<typeof vi.fn>).mock.calls
    expect(partCalls[0]?.[0]).toBe('up-1')
    expect(partCalls[0]?.[3]).toBe(h.controller.signal) // 分片用注入 signal（取消通道）

    expect(h.deps.complete).toHaveBeenCalledWith('up-1')
    expect(h.deps.cancel).not.toHaveBeenCalled()
    // 续传记录：start 后即落盘（四字段 + expiresAt），成功后 forget
    expect(h.deps.storage.save).toHaveBeenCalledWith({
      id: 'up-1',
      name: NAME,
      size: BIG_SIZE,
      lastModified: LAST_MODIFIED,
      folderID: FOLDER,
      expiresAt: FAR_FUTURE,
    })
    expect(h.deps.storage.forget).toHaveBeenCalledWith('up-1')
    expect(h.records).toHaveLength(0)

    // percent 单调不减，且随分片确认逐步逼近 100
    const percents = h.tasks.map((t) => t.percent)
    for (let i = 1; i < percents.length; i++) {
      expect((percents[i] ?? 0) >= (percents[i - 1] ?? 0)).toBe(true)
    }
    const statuses = h.tasks.map((t) => t.status)
    expect(statuses[0]).toBe('uploading')
    expect(statuses.indexOf('merging')).toBeGreaterThan(-1)
    expect(statuses.lastIndexOf('done')).toBe(statuses.length - 1)
    expect(statuses.indexOf('merging')).toBeLessThan(statuses.lastIndexOf('done'))
    expect(h.tasks.at(-1)).toMatchObject({ status: 'done', percent: 100 })
  })
})

describe('runUpload：续传记录命中（用例③）', () => {
  it('uploaded_parts 已有 2 片 → uploadPart 只补传缺失分片（次数 = total − uploaded）', async () => {
    const h = createHarness()
    seedPrevious(h)
    h.progress.uploaded_parts = [2, 5]
    await h.run()

    expect(h.deps.getProgress).toHaveBeenCalledWith('up-1')
    expect(h.deps.startMultipart).not.toHaveBeenCalled() // 续传用 progress 回给的 session
    expect(partNumbers(h)).toHaveLength(TOTAL_PARTS - 2)
    expect(new Set(partNumbers(h))).toEqual(new Set([1, 3, 4, 6, 7]))
    expect(h.deps.complete).toHaveBeenCalledWith('up-1')
    // 续传起点 percent 直接反映已确认分片（2/7 → 28%）
    expect(h.tasks.some((t) => t.percent === Math.floor((2 / TOTAL_PARTS) * 100))).toBe(true)
    expect(h.records).toHaveLength(0)
  })

  it('四字段任一不匹配 → 不续传（folderID 不同即全新 start，异 id 旧记录不被动）', async () => {
    const h = createHarness()
    seedPrevious(h, { id: 'up-old', folderID: 99 })
    await h.run() // folderID=3 ≠ 记录 99 → 不匹配；新会话 id 独立，避免与旧记录同 id 干扰 forget 断言
    expect(h.deps.getProgress).not.toHaveBeenCalled()
    expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
    expect(h.deps.storage.forget).not.toHaveBeenCalledWith('up-old')
    expect(h.records.some((r) => r.id === 'up-old')).toBe(true)
    expect(partNumbers(h)).toHaveLength(TOTAL_PARTS)
  })

  it('记录已过期 → forget 旧记录后全新 start（旧 537 行分支）', async () => {
    const h = createHarness()
    seedPrevious(h, { expiresAt: '2020-01-01T00:00:00Z' })
    await h.run()
    expect(h.deps.getProgress).not.toHaveBeenCalled()
    expect(h.deps.storage.forget).toHaveBeenCalledWith('up-1')
    expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
    expect(partNumbers(h)).toHaveLength(TOTAL_PARTS)
  })
})

describe('runUpload：progress.status 分支与进度探测错误（用例④⑤ / Review Focus #2）', () => {
  it('status=2 →「正在恢复合并」直接 complete，不 start、不传分片', async () => {
    const h = createHarness()
    seedPrevious(h)
    h.progress.status = 2
    await h.run()
    expect(h.deps.complete).toHaveBeenCalledWith('up-1')
    expect(h.deps.startMultipart).not.toHaveBeenCalled()
    expect(h.deps.uploadPart).not.toHaveBeenCalled()
    expect(h.deps.storage.forget).toHaveBeenCalledWith('up-1')
    const statuses = h.tasks.map((t) => t.status)
    expect(statuses).toContain('merging')
    expect(statuses.at(-1)).toBe('done')
  })

  it('status=3 → forget + 结束（忠实旧版：文件不再上传、任务正常收敛）', async () => {
    const h = createHarness()
    seedPrevious(h)
    h.progress.status = 3
    await h.run()
    expect(h.deps.storage.forget).toHaveBeenCalledWith('up-1')
    expect(h.deps.startMultipart).not.toHaveBeenCalled()
    expect(h.deps.uploadPart).not.toHaveBeenCalled()
    expect(h.deps.complete).not.toHaveBeenCalled()
    expect(h.tasks.at(-1)!.status).toBe('done')
  })

  it('status=4 → forget 后全新 start，全量分片重传', async () => {
    const h = createHarness()
    seedPrevious(h)
    h.progress.status = 4
    await h.run()
    expect(h.deps.storage.forget).toHaveBeenCalledWith('up-1')
    expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
    expect(partNumbers(h)).toHaveLength(TOTAL_PARTS)
    expect(h.deps.complete).toHaveBeenCalledWith('up-1')
  })

  it('进度探测 404/409 → forget 旧记录 + 全新 start（两态同分支）', async () => {
    for (const status of [404, 409] as const) {
      const h = createHarness({
        getProgress: vi.fn(async (): Promise<MultipartUploadProgress> => {
          throw new ApiError(status === 404 ? 'upload session not found' : 'upload session cannot be completed', status)
        }),
      })
      seedPrevious(h)
      await h.run()
      expect(h.deps.storage.forget).toHaveBeenCalledWith('up-1')
      expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
      expect(partNumbers(h)).toHaveLength(TOTAL_PARTS)
      expect(h.deps.complete).toHaveBeenCalledWith('up-1')
      expect(h.tasks.at(-1)!.status).toBe('done')
    }
  })

  it('进度探测非 404/409（如 500）→ 原样上抛：不 forget、不 start（Review Focus #2 反例锁）', async () => {
    const err = new ApiError('服务暂时遇到问题，请稍后重试。', 500)
    const h = createHarness({
      getProgress: vi.fn(async (): Promise<MultipartUploadProgress> => {
        throw err
      }),
    })
    seedPrevious(h)
    await expect(h.run()).rejects.toBe(err)
    expect(h.deps.storage.forget).not.toHaveBeenCalled()
    expect(h.deps.startMultipart).not.toHaveBeenCalled()
    expect(h.records).toHaveLength(1)
  })
})

describe('runUpload：取消与合并阶段（用例⑥ + 旧 544 行「合并禁断」）', () => {
  it('merging 中 signal.abort 不中断 complete：任务以 done 收敛，cancel 不调用', async () => {
    const h = createHarness()
    let aborted = false
    await h.run(bigFile(), FOLDER, (t) => {
      if (t.status === 'merging' && !aborted) {
        aborted = true
        h.controller.abort() // 合并阶段收到取消 → runUpload 不再读信号（旧版 cancelCurrentUpload 直接 return）
      }
    })
    expect(aborted).toBe(true)
    expect(h.deps.complete).toHaveBeenCalledTimes(1)
    expect(h.deps.cancel).not.toHaveBeenCalled()
    expect(h.tasks.at(-1)).toMatchObject({ status: 'done', percent: 100 })
    expect(h.records).toHaveLength(0) // 成功路径 forget 照旧
  })

  it('分片阶段 abort → cancelMultipartUpload + forget + status=cancelled（promise 不 reject）', async () => {
    const h = createHarness({
      uploadPart: vi.fn(async (_id: string, _n: number, _part: Blob, signal: AbortSignal) => {
        if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
      }),
    })
    let abortQueued = false
    await h.run(bigFile(), FOLDER, (t) => {
      // 首个分片确认后立即取消
      if (!abortQueued && t.status === 'uploading' && t.percent > 0) {
        abortQueued = true
        h.controller.abort()
      }
    })
    expect(abortQueued).toBe(true)
    expect(h.deps.cancel).toHaveBeenCalledTimes(1)
    expect(h.deps.cancel).toHaveBeenCalledWith('up-1')
    expect(h.deps.complete).not.toHaveBeenCalled()
    expect(h.records).toHaveLength(0) // 取消即 forget（旧 552-556）
    expect(h.tasks.at(-1)!.status).toBe('cancelled')
  })

  it('分片循环开始前已 abort → 不发任何分片，直接 cancel+forget 收敛', async () => {
    const h = createHarness()
    h.controller.abort()
    await h.run()
    expect(h.deps.uploadPart).not.toHaveBeenCalled()
    expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
    expect(h.deps.cancel).toHaveBeenCalledWith('up-1')
    expect(h.tasks.at(-1)!.status).toBe('cancelled')
  })
})

describe('runUpload：配额失败保留记录可续传重试（用例⑦ / Review Focus #5）', () => {
  it('complete 507 → reject 原始 ApiError 且记录未 forget；重跑走续传直接合并成功', async () => {
    const quotaError = new ApiError('云仓可用存储空间不足。', 507)
    const h = createHarness({
      complete: vi.fn(async () => {
        throw quotaError
      }),
    })
    await expect(h.run()).rejects.toBe(quotaError)
    expect(h.tasks.at(-1)).toMatchObject({ status: 'failed', error: '云仓可用存储空间不足。' })
    expect(h.deps.storage.forget).not.toHaveBeenCalled() // 关键：失败不 forget
    expect(h.records).toHaveLength(1) // 记录留库，续传四字段可直接命中

    // 重跑：记录命中 + 服务端确认分片全在（旧版重选同一文件即从此处继续）
    const h2 = createHarness({ storage: h.deps.storage })
    h2.progress.uploaded_parts = [1, 2, 3, 4, 5, 6, 7]
    await h2.run()
    expect(h2.deps.getProgress).toHaveBeenCalledWith('up-1')
    expect(h2.deps.uploadPart).not.toHaveBeenCalled() // 全部已确认 → 零补传
    expect(h2.deps.complete).toHaveBeenCalledWith('up-1')
    expect(h2.tasks.at(-1)!.status).toBe('done')
    expect(h2.records).toHaveLength(0) // 成功后 forget，闭环
  })
})
