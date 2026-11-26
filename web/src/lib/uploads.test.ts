// Task 8 Step 1：上传编排纯逻辑行为锚（brief 7 用例全覆盖，全部注入 fake deps，零网络/零 localStorage）。
// 旧语义逐项钉死（FileWorkbench.vue:457-558 @adbcfba）：≥49MiB 阈值分流、续传四字段匹配、
// progress.status 2/3/4 分支、404/409 forget+全新 start（Review Focus #2，其余 status 原样上抛）、
// 合并阶段忽略取消、取消 cancel+forget、失败抛原始 ApiError 且续传记录保留（Review Focus #5）。
// 新语义：分片并发（默认 3）不改变「uploadPart 调用次数 = total − uploaded」等可观测结果。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { INSTANT_PROBE_TIMEOUT_MS } from '@/api/storage'
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

/** 纯 Promise 世界的轮询等待（本文件不依赖 RTL，自带最小 waitFor）。 */
async function waitFor(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error
      await new Promise((r) => setTimeout(r, 10))
    }
  }
}

/** 无头环境不依赖真 Blob：runUpload 只读 name/size/lastModified 与 slice() 边界。 */
function makeFile(size: number, name = NAME, lastModified = LAST_MODIFIED): File {
  return createTrackedFile(size, name, lastModified).file
}

/** 修复轮 1 / Important-4：slice() 范围可观测版本——ranges 记录每次切片的 [start, end]，
 *  返回 Blob 桩的 size 即 end−start，供逐片偏移/尾片断言（named risk：尾片与带洞续传此前未验）。 */
function createTrackedFile(size: number, name = NAME, lastModified = LAST_MODIFIED): {
  file: File
  ranges: Array<[number, number]>
} {
  const ranges: Array<[number, number]> = []
  const file = {
    name,
    size,
    lastModified,
    type: 'application/octet-stream',
    slice: (start?: number, end?: number) => {
      const s = start ?? 0
      const e = end ?? size
      ranges.push([s, e])
      return { size: e - s } as unknown as Blob
    },
  } as unknown as File
  return { file, ranges }
}

function bigFile(): File {
  return makeFile(BIG_SIZE)
}

/**
 * W3：带真实字节的直传 fake 文件——arrayBuffer() 返回编码字节，供「假 subtle 记录哈希输入=文件原字节」断言；
 * slice 直接抛错（<49MiB 路径不该触到分片，触到即测试自炸）。
 */
function createInstantFile(
  content: string,
  options: { size?: number; name?: string; type?: string; lastModified?: number } = {},
): { file: File; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode(content)
  const buffer = bytes.buffer as ArrayBuffer
  const file = {
    name: options.name ?? NAME,
    size: options.size ?? bytes.byteLength,
    lastModified: options.lastModified ?? LAST_MODIFIED,
    type: options.type ?? 'application/octet-stream',
    arrayBuffer: async () => buffer,
    slice: () => {
      throw new Error('direct-upload path must not slice')
    },
  } as unknown as File
  return { file, bytes }
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
    // W3 秒传探针注入点（spec §2 deps 契约）：默认假 subtle/假探针（恒 miss）——
    // 既有用例直传行为「与旧完全一致」正由 miss 分支原样走直传保证。
    sha256Hex: vi.fn(async () => 'e'.repeat(64)),
    instantProbe: vi.fn(async (): Promise<'linked' | 'miss'> => 'miss'),
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

beforeEach(() => {
  // MINOR-2：编排层 DEV 降级留痕会 console.debug（vitest env DEV=true）——全局静音保持输出 pristine，
  // 具体断言的用例自行重挂 spy。vi.restoreAllMocks() 在 afterEach 负责复原。
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

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
    const tracked = createTrackedFile(BIG_SIZE)
    await h.run(tracked.file)

    expect(h.deps.startMultipart).toHaveBeenCalledTimes(1)
    expect(h.deps.getProgress).not.toHaveBeenCalled() // 无历史记录不发进度探测
    expect(partNumbers(h)).toHaveLength(TOTAL_PARTS)
    expect(new Set(partNumbers(h))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))
    const partCalls = (h.deps.uploadPart as ReturnType<typeof vi.fn>).mock.calls
    expect(partCalls[0]?.[0]).toBe('up-1')
    // 修复轮 1 / Important-3：分片收到的是内部中继信号（联动 deps.signal + 首败广播），非直连外部 signal
    expect(partCalls[0]?.[3]).toBeInstanceOf(AbortSignal)

    // 修复轮 1 / Important-4：切片范围逐片钉死——偏移 (n−1)×part_size，尾片截到 file.size（49MiB−48MiB=1MiB）
    const expectedRanges = Array.from({ length: TOTAL_PARTS }, (_, i) => [
      i * PART_SIZE,
      Math.min((i + 1) * PART_SIZE, BIG_SIZE),
    ] as [number, number])
    expect([...tracked.ranges].sort((a, b) => a[0] - b[0])).toEqual(expectedRanges)
    const blobSizeByPart = new Map(partCalls.map((call) => [call[1], (call[2] as Blob).size]))
    expect(blobSizeByPart.get(7)).toBe(1 * MiB)
    for (const n of [1, 2, 3, 4, 5, 6]) expect(blobSizeByPart.get(n)).toBe(PART_SIZE)

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
    const tracked = createTrackedFile(BIG_SIZE)
    await h.run(tracked.file)

    expect(h.deps.getProgress).toHaveBeenCalledWith('up-1')
    expect(h.deps.startMultipart).not.toHaveBeenCalled() // 续传用 progress 回给的 session
    expect(partNumbers(h)).toHaveLength(TOTAL_PARTS - 2)
    expect(new Set(partNumbers(h))).toEqual(new Set([1, 3, 4, 6, 7]))
    // 修复轮 1 / Important-4：带洞续传的切片偏移=按原始编号（跳过 2/5 不移位），尾片仍 1MiB
    const partCalls = (h.deps.uploadPart as ReturnType<typeof vi.fn>).mock.calls
    const blobSizeByPart = new Map(partCalls.map((call) => [call[1], (call[2] as Blob).size]))
    expect([...blobSizeByPart.keys()].sort()).toEqual([1, 3, 4, 6, 7])
    expect(blobSizeByPart.get(7)).toBe(1 * MiB)
    for (const n of [1, 3, 4, 6]) expect(blobSizeByPart.get(n)).toBe(PART_SIZE)
    expect([...tracked.ranges].sort((a, b) => a[0] - b[0])).toEqual([
      [0, PART_SIZE],
      [2 * PART_SIZE, 3 * PART_SIZE],
      [3 * PART_SIZE, 4 * PART_SIZE],
      [5 * PART_SIZE, 6 * PART_SIZE],
      [6 * PART_SIZE, BIG_SIZE],
    ])
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

  it('status=3（StatusCompleted：服务端已完成合并）→ forget + done 收敛（修复轮 1 / Minor-5 勘误注释）', async () => {
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

  it('进度探测非 404/409（如 500）→ 原样上抛：不 forget、不 start、task 收敛 failed（Review Focus #2 反例锁）', async () => {
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
    expect(h.tasks.at(-1)!.status).toBe('failed') // 修复轮 1 / Critical-1：预-loop 抛出也必须离开 uploading
  })
})

describe('runUpload：预-loop 失败统一收敛 failed（修复轮 1 / Critical-1）', () => {
  it('status=2 恢复合并分支 complete 抛错 → reject 原始错误 + task failed（不再冻结 uploading 行）', async () => {
    const err = new ApiError('文件分片尚未全部上传，请重试未完成的分片。', 400)
    const h = createHarness({
      complete: vi.fn(async () => {
        throw err
      }),
    })
    seedPrevious(h)
    h.progress.status = 2
    await expect(h.run()).rejects.toBe(err)
    expect(h.deps.storage.forget).not.toHaveBeenCalled()
    expect(h.deps.startMultipart).not.toHaveBeenCalled()
    expect(h.deps.uploadPart).not.toHaveBeenCalled()
    const statuses = h.tasks.map((t) => t.status)
    expect(statuses).toContain('merging') // 进入了恢复合并
    expect(h.tasks.at(-1)).toMatchObject({ status: 'failed', error: err.message })
  })

  it('startMultipart 507（配额）→ reject 原始 ApiError + task failed：不落记录、不传分片', async () => {
    const err = new ApiError('云仓可用存储空间不足。', 507)
    const h = createHarness({
      startMultipart: vi.fn(async (): Promise<MultipartUploadSession> => {
        throw err
      }),
    })
    await expect(h.run()).rejects.toBe(err)
    expect(h.deps.storage.save).not.toHaveBeenCalled()
    expect(h.deps.uploadPart).not.toHaveBeenCalled()
    expect(h.deps.complete).not.toHaveBeenCalled()
    expect(h.records).toHaveLength(0)
    expect(h.tasks.at(-1)).toMatchObject({ status: 'failed', error: '云仓可用存储空间不足。' })
  })
})

describe('runUpload：兄弟 lane 首败广播停止（修复轮 1 / Important-3）', () => {
  it('分片 2 失败 → 并发窗口外的分片绝不再启动；percent 不再增长；failed 只发一次', async () => {
    const err = new ApiError('服务暂时遇到问题，请稍后重试。', 500)
    const gates = new Map<number, { resolve: () => void; reject: (e: unknown) => void }>()
    const seenSignals: AbortSignal[] = []
    const h = createHarness({
      uploadPart: vi.fn(async (_id: string, n: number, _part: Blob, signal: AbortSignal) => {
        seenSignals.push(signal)
        await new Promise<void>((resolve, reject) => {
          gates.set(n, { resolve, reject })
        })
      }),
    })
    const runPromise = h.run()
    // 三 lane 同步各拉一片（并发=3）：等待观测到 1/2/3 全部开播
    await waitFor(() => expect(seenSignals).toHaveLength(3))
    gates.get(2)!.reject(err) // 片 2 真失败（非用户取消）
    gates.get(1)!.resolve()
    gates.get(3)!.resolve()

    await expect(runPromise).rejects.toBe(err)
    expect(partNumbers(h)).toEqual([1, 2, 3]) // 4..7 从未被任何 lane 拉取（修复前此断言挂：w1/w3 会继续爬 4/5）
    const statuses = h.tasks.map((t) => t.status)
    expect(statuses.filter((s) => s === 'failed')).toHaveLength(1)
    expect(statuses.at(-1)).toBe('failed') // failed 之后无任何 emission → percent 不再增长
    expect(h.deps.complete).not.toHaveBeenCalled()
    expect(h.deps.cancel).not.toHaveBeenCalled()
    expect(h.records).toHaveLength(1) // 失败仍保留续传记录（Review Focus #5 契约不受影响）
    expect(seenSignals.every((s) => s.aborted)).toBe(true) // 失败广播也掐断了在途请求的信号
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

describe('runUpload：W3 秒传探针接线（spec §1.2 / builder-check 裁定）', () => {
  /** 取注入 deps 的 spy 调用记录。 */
  const callsOf = (fn: unknown): unknown[][] => (fn as ReturnType<typeof vi.fn>).mock.calls

  it('linked → done+instant=true 且 uploadFile(putDirect) 绝不调用；探针期间零 emission（任务恒 queued 0%）', async () => {
    const seenBuffers: ArrayBuffer[] = []
    const h = createHarness({
      sha256Hex: vi.fn(async (buffer: ArrayBuffer) => {
        seenBuffers.push(buffer) // 「假 subtle 记录收到的 ArrayBuffer」
        return 'f'.repeat(64)
      }),
      instantProbe: vi.fn(async (): Promise<'linked' | 'miss'> => 'linked'),
    })
    const { file, bytes } = createInstantFile('hello-instant', { type: 'text/plain' })
    await h.run(file)

    expect(h.deps.uploadFile).not.toHaveBeenCalled() // 命中=零字节，直传请求绝不发出
    expect(callsOf(h.deps.startMultipart)).toHaveLength(0)
    expect(h.deps.storage.save).not.toHaveBeenCalled()
    const doneRows = h.tasks.filter((t) => t.status === 'done')
    expect(doneRows).toHaveLength(1) // done 只发一次 → 队列层 invalidate 恰一次
    expect(doneRows[0]).toMatchObject({ status: 'done', percent: 100, instant: true })
    expect(h.tasks.every((t) => t.status !== 'uploading')).toBe(true) // 不新增状态：探针期间无 uploading emission
    // 哈希输入=文件 arrayBuffer 原字节（逐字节相等；Array.from 绕开 vitest/jsdom 跨 realm Uint8Array 比较怪癖）
    expect(seenBuffers).toHaveLength(1)
    expect(Array.from(new Uint8Array(seenBuffers[0]!))).toEqual(Array.from(bytes))
    // 探针入参=后端 instantFileRequest 形状（content_type 取 file.type 原值）
    expect(callsOf(h.deps.instantProbe)).toEqual([
      [{ sha256: 'f'.repeat(64), original_name: NAME, content_type: 'text/plain', folder_id: FOLDER }],
    ])
  })

  it('miss → uploadFile 恰一次、行为与旧直传逐字段一致（done 无 instant；file.type 空 → octet-stream 兜底）', async () => {
    const h = createHarness()
    const { file } = createInstantFile('cold-bytes', { type: '' })
    await h.run(file)
    expect(h.deps.uploadFile).toHaveBeenCalledTimes(1)
    expect(h.deps.uploadFile).toHaveBeenCalledWith(file, FOLDER)
    expect(callsOf(h.deps.instantProbe)).toEqual([
      [{ sha256: 'e'.repeat(64), original_name: NAME, content_type: 'application/octet-stream', folder_id: FOLDER }],
    ])
    const statuses = h.tasks.map((t) => t.status)
    expect(statuses).toEqual(['uploading', 'done']) // 与既有用例①的 emission 序列完全一致
    expect(h.tasks.at(-1)).toMatchObject({ status: 'done', percent: 100 })
    expect(h.tasks.at(-1)!.instant).toBeUndefined()
  })

  it('探针 507 → 静默降级直传：不提前报错、任务不因探针 failed，最终 done；MINOR-2 DEV 留痕', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {}) // 覆盖文件级静音，验留痕本身
    const err = new ApiError('云仓可用存储空间不足。', 507)
    const h = createHarness({
      instantProbe: vi.fn(async (): Promise<'linked' | 'miss'> => {
        throw err
      }),
    })
    const { file } = createInstantFile('quota-but-silent')
    await h.run(file)
    expect(h.deps.uploadFile).toHaveBeenCalledTimes(1)
    expect(h.tasks.some((t) => t.status === 'failed')).toBe(false)
    expect(h.tasks.every((t) => t.error === undefined)).toBe(true) // 错误面零提前外泄（配额由直传原样复现）
    expect(h.tasks.at(-1)!.status).toBe('done')
    // MINOR-2：降级对用户静默但 DEV 下可观测（reason 不丢——生产「秒传从未命中」可归因）
    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalledWith('instant probe degraded', err)
  })

  it('RF1：探针永不落定（网络黑洞）→ INSTANT_PROBE_TIMEOUT_MS 封顶静默降级直传，队列不永久挂起', async () => {
    vi.useFakeTimers()
    try {
      const h = createHarness({
        instantProbe: vi.fn(() => new Promise<'linked' | 'miss'>(() => {})), // 永不 resolve/reject
      })
      const { file } = createInstantFile('blackhole')
      const run = h.run(file)
      for (let i = 0; i < 64; i++) await Promise.resolve() // 冲微任务：抵达 instantProbe，计时器于 t=0 挂表
      expect(h.deps.instantProbe).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(INSTANT_PROBE_TIMEOUT_MS - 1)
      expect(h.deps.uploadFile).not.toHaveBeenCalled() // 窗口未满仍在等探针
      expect(h.tasks.every((t) => t.status === 'queued')).toBe(true) // 无假 done/failed 泄漏
      await vi.advanceTimersByTimeAsync(2) // 越 3000ms 界
      await run
      expect(h.deps.uploadFile).toHaveBeenCalledTimes(1) // 超时=普通探针失败 → 静默降级
      expect(h.tasks.at(-1)!.status).toBe('done')
      expect(vi.getTimerCount()).toBe(0) // 竞速表自清，不残留
    } finally {
      vi.useRealTimers()
    }
  })

  it('哈希失败（无 subtle 旧环境）→ 降级直传不阻断，探针不发', async () => {
    const h = createHarness({
      sha256Hex: vi.fn(async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'digest')")
      }),
    })
    const { file } = createInstantFile('no-subtle-env')
    await h.run(file)
    expect(h.deps.instantProbe).not.toHaveBeenCalled()
    expect(h.deps.uploadFile).toHaveBeenCalledTimes(1)
    expect(h.tasks.at(-1)!.status).toBe('done')
  })

  it('哈希期间取消 → cancelled，探针/uploadFile 零后续调用（假 sha 悬挂也被掐停）', async () => {
    let releaseHash!: (value: string) => void
    const h = createHarness({
      sha256Hex: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            releaseHash = resolve
          }),
      ),
    })
    const { file } = createInstantFile('cancel-in-hash')
    const run = h.run(file)
    await waitFor(() => expect(h.deps.sha256Hex).toHaveBeenCalledTimes(1))
    h.controller.abort()
    releaseHash('arrives-after-abort') // 迟到的哈希结果必须被丢弃
    await run
    expect(h.deps.instantProbe).not.toHaveBeenCalled()
    expect(h.deps.uploadFile).not.toHaveBeenCalled()
    expect(h.deps.cancel).not.toHaveBeenCalled() // 直传无分片会话可 cancel
    expect(h.deps.storage.forget).not.toHaveBeenCalled()
    expect(h.tasks.every((t) => t.status !== 'done')).toBe(true)
    expect(h.tasks.at(-1)!.status).toBe('cancelled')
  })

  it('探针期间取消 → 并入既有 cancelled 分支；迟到的 201 命中也不再 emit done、不发直传', async () => {
    let releaseProbe!: (value: 'linked' | 'miss') => void
    const h = createHarness({
      instantProbe: vi.fn(
        () =>
          new Promise<'linked' | 'miss'>((resolve) => {
            releaseProbe = resolve
          }),
      ),
    })
    const { file } = createInstantFile('cancel-in-probe')
    const run = h.run(file)
    await waitFor(() => expect(h.deps.instantProbe).toHaveBeenCalledTimes(1))
    h.controller.abort()
    await run // 取消即刻收敛，无需等探针承诺落定
    releaseProbe('linked')
    await new Promise((r) => setTimeout(r, 10))
    expect(h.deps.uploadFile).not.toHaveBeenCalled()
    expect(h.tasks.every((t) => t.status !== 'done')).toBe(true)
    expect(h.tasks.at(-1)!.status).toBe('cancelled')
  })

  it('入探针前已 abort（queued 期取消）→ cancelled，arrayBuffer/sha256Hex/探针/uploadFile 全零调用', async () => {
    const h = createHarness()
    const { file } = createInstantFile('never-hashed')
    // arrayBuffer 归文件桩所有：包一层计数以断言「哈希都还没开始就取消」
    const spy = vi.fn(async () => new ArrayBuffer(0))
    const withSpy = { ...file, arrayBuffer: spy } as unknown as File
    h.controller.abort()
    await h.run(withSpy)
    expect(spy).not.toHaveBeenCalled()
    expect(h.deps.sha256Hex).not.toHaveBeenCalled()
    expect(h.deps.instantProbe).not.toHaveBeenCalled()
    expect(h.deps.uploadFile).not.toHaveBeenCalled()
    expect(h.tasks.at(-1)!.status).toBe('cancelled')
  })

  it('≥49MiB multipart 路径零改动：sha256Hex/探针从不被调（v1 边界，spec §1.2 阈值以下专属）', async () => {
    const h = createHarness()
    await h.run()
    expect(h.deps.sha256Hex).not.toHaveBeenCalled()
    expect(h.deps.instantProbe).not.toHaveBeenCalled()
    expect(h.tasks.at(-1)!.status).toBe('done')
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
