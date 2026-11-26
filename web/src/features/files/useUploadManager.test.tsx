// Task 8 队列管理器行为锚（jsdom）：文件级串行（队列并发 1=旧 for-await）、成功 invalidate
// ['files']+['usage']、批次完成 toast「已上传 N 个文件。」（旧 503 文案）、失败熔断批次留 queued
// 可重试（旧 uploadFiles catch 语义 + brief 重试契约）、queued 行取消出队。
// fetch 桩按 URL+method 路由（Task 7 同纪律）；直传小文件走 api/storage.uploadFile 真实实现 → request → 桩，
// POST 默认悬挂由用例手动放行，以此观察串行序。Attachment 行的 UI 态（合并禁断按钮等）在此直测。
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { toast, Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Attachment } from '@/components/app/Attachment'
import { UploadQueuePanel } from '@/components/app/UploadQueuePanel'
import { resetUploadManager, useUploadManager } from './useUploadManager'
import type { UploadTask } from '@/lib/uploads'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

interface Posted {
  name: string
  resolve: (r: Response) => void
}
let posts: Posted[] = []
let autoRespond: Response | null = null // 非 null 时新 POST 直接以该响应收敛（不再悬挂）

// W3：/api/v1/files/instant 探针路由——默认逐请求消费 instantResponses 队列，缺省回 200 miss
// （既有直传用例因此行为不变：探针静默未命中 → 原样直传）。'gate' 哨兵则悬挂待手动 resolve，
// 供「探针期间取消」「命中前观察 queued 态」用例钉时序。
type InstantReply = Response | 'gate'
let instantResponses: InstantReply[] = []
let instantRequests: Array<{ body: Record<string, unknown>; resolve: (r: Response) => void }> = []

/** W3：jsdom 无 crypto.subtle（spec §6）——lib/crypto.ts 真 adapter 不进单测，队列层接线用例注入假 subtle。 */
function stubSubtle(): void {
  vi.stubGlobal('crypto', {
    getRandomValues: <T extends ArrayBufferView>(arr: T): T => arr,
    subtle: { digest: async (_alg: string, _data: ArrayBuffer) => new Uint8Array(32).buffer },
  })
}

beforeEach(() => {
  posts = []
  autoRespond = null
  instantResponses = []
  instantRequests = []
  resetUploadManager()
  // sonner 的 toast store 是模块级队列，默认 4s 自毁定时器跨用例存活——
  // W3 新增「已上传 N 个文件。」相邻用例会被上一例残留 toast 串扰（queryByText 命中多个）。
  toast.dismiss()
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/files' && init?.method === 'POST') {
        const file = (init.body as FormData).get('file') as File
        if (autoRespond) return Promise.resolve(autoRespond)
        return new Promise<Response>((resolve) => {
          posts.push({ name: file.name, resolve }) // 入桩数组顺序即开播顺序（串行断言的观测面）
        })
      }
      if (url === '/api/v1/files/instant' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        const next = instantResponses.shift() ?? jsonResponse(200, { exists: false })
        if (next === 'gate') {
          return new Promise<Response>((resolve) => {
            instantRequests.push({ body, resolve })
          })
        }
        return Promise.resolve(next)
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetUploadManager()
})

type ManagerView = ReturnType<typeof useUploadManager>
let view: ManagerView | null = null
let queryClient: QueryClient

function Probe() {
  view = useUploadManager()
  return null
}

function renderHarness(withPanel: boolean): void {
  view = null
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Probe />
        {withPanel ? <UploadQueuePanel /> : null}
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  )
}

function fileNamed(name: string): File {
  return new File([name], name, { type: 'text/plain' })
}

async function waitForPosts(n: number): Promise<void> {
  await waitFor(() => expect(posts).toHaveLength(n))
}

describe('useUploadManager：串行队列与缓存失效', () => {
  it('两文件串行：A 未落定不发 B；全部成功 → 行 done + invalidate files/usage + 批次 toast（旧文案）', async () => {
    renderHarness(true)
    await waitFor(() => expect(view).not.toBeNull())
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    act(() => {
      view!.submitFiles([fileNamed('a.txt'), fileNamed('b.txt')], 3)
    })

    // 队列并发 1：首个 POST 悬挂期间绝不出现第二个
    await waitForPosts(1)
    expect(posts[0]!.name).toBe('a.txt')
    await new Promise((r) => setTimeout(r, 10))
    expect(posts).toHaveLength(1)

    // 面板：两行 queued/uploading 都渲染在 aria-live 区域里
    expect(screen.getByTestId('upload-queue')).toBeInTheDocument()
    expect(screen.getByLabelText('上传进度')).toBeInTheDocument()
    expect(screen.getAllByTestId('attachment')).toHaveLength(2)

    act(() => {
      posts[0]!.resolve(jsonResponse(200, { id: 10 }))
    })
    await waitForPosts(2) // A 收敛后 B 才开播（串行证明）
    expect(posts[1]!.name).toBe('b.txt')
    act(() => {
      posts[1]!.resolve(jsonResponse(200, { id: 11 }))
    })

    await waitFor(() => {
      expect(view!.tasks.map((t) => t.status)).toEqual(['done', 'done'])
    })
    expect(view!.tasks.every((t) => t.percent === 100)).toBe(true)
    // 每成功一个文件双失效（前缀 ['files'] 覆盖 ['files',f,p] 全部分页/目录，['usage'] 用量条）
    expect(invalidateSpy.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([{ queryKey: ['files'] }, { queryKey: ['usage'] }]),
    )
    expect(invalidateSpy).toHaveBeenCalledTimes(4)
    expect(await screen.findByText('已上传 2 个文件。')).toBeInTheDocument()
  })

  it('失败熔断批次（旧 uploadFiles catch）：后续文件不再自动开播、停留 queued；toast 原样错误文案', async () => {
    renderHarness(false)
    await waitFor(() => expect(view).not.toBeNull())

    act(() => {
      view!.submitFiles([fileNamed('fail.txt'), fileNamed('later.txt')], 0)
    })
    await waitForPosts(1)
    act(() => {
      posts[0]!.resolve(jsonResponse(500, { error: 'db down' }))
    })

    await waitFor(() => {
      expect(view!.tasks[0]?.status).toBe('failed')
    })
    expect(view!.tasks[0]?.error).toBe('服务暂时遇到问题，请稍后重试。')
    await new Promise((r) => setTimeout(r, 10))
    expect(posts).toHaveLength(1) // 熔断：later.txt 未被开播
    expect(view!.tasks[1]?.status).toBe('queued')
    expect(await screen.findByText('服务暂时遇到问题，请稍后重试。')).toBeInTheDocument()
  })

  it('重试 = 以同一 File 重跑：失败行复位 queued → 成功后串行自动续跑被熔断的后续文件', async () => {
    renderHarness(false)
    await waitFor(() => expect(view).not.toBeNull())

    act(() => {
      view!.submitFiles([fileNamed('fail.txt'), fileNamed('later.txt')], 0)
    })
    await waitForPosts(1)
    act(() => {
      posts[0]!.resolve(jsonResponse(500, { error: 'db down' }))
    })
    await waitFor(() => expect(view!.tasks[0]?.status).toBe('failed'))

    autoRespond = jsonResponse(200, { id: 42 })
    const failedId = view!.tasks[0]!.id
    act(() => {
      view!.retryTask(failedId)
    })

    await waitFor(() => {
      expect(view!.tasks.map((t) => t.status)).toEqual(['done', 'done'])
    })
    expect(view!.tasks[0]?.name).toBe('fail.txt') // 同一 File 引用重跑（entries 表）
    expect(view!.tasks[1]?.name).toBe('later.txt')
  })

  it('queued 行取消：出队即 cancelled，绝不开播；进行中文件不受影响', async () => {
    renderHarness(false)
    await waitFor(() => expect(view).not.toBeNull())

    act(() => {
      view!.submitFiles([fileNamed('a.txt'), fileNamed('b.txt')], 0)
    })
    await waitForPosts(1)
    const queuedId = view!.tasks[1]!.id
    act(() => {
      view!.cancelTask(queuedId)
    })
    expect(view!.tasks[1]?.status).toBe('cancelled')

    act(() => {
      posts[0]!.resolve(jsonResponse(200, { id: 10 }))
    })
    await waitFor(() => expect(view!.tasks[0]?.status).toBe('done'))
    await new Promise((r) => setTimeout(r, 10))
    expect(posts).toHaveLength(1) // b.txt 从未发出
    expect(view!.tasks[1]?.status).toBe('cancelled')
  })

  it('修复轮 1 / Important-2：批次熔断后新的 submitFiles 恢复泵送（不再搁浅 queued 行与后续文件）', async () => {
    renderHarness(false)
    await waitFor(() => expect(view).not.toBeNull())

    // 批次 1：fail.txt 500 熔断 → ok1.txt 滞留 queued，队列停摆
    act(() => {
      view!.submitFiles([fileNamed('fail.txt'), fileNamed('ok1.txt')], 0)
    })
    await waitForPosts(1)
    act(() => {
      posts[0]!.resolve(jsonResponse(500, { error: 'db down' }))
    })
    await waitFor(() => expect(view!.tasks[0]?.status).toBe('failed'))
    expect(view!.tasks[1]?.status).toBe('queued')

    // 用户重新提交 ok2.txt → 必须恢复泵送（原队列里滞留的 ok1 先跑，随后 ok2）
    act(() => {
      view!.submitFiles([fileNamed('ok2.txt')], 0)
    })
    await waitForPosts(2)
    expect(posts[1]!.name).toBe('ok1.txt') // 熔断解除后队列自然续跑，不吞新意图
    act(() => {
      posts[1]!.resolve(jsonResponse(200, { id: 21 }))
    })
    await waitForPosts(3)
    expect(posts[2]!.name).toBe('ok2.txt')
    act(() => {
      posts[2]!.resolve(jsonResponse(200, { id: 22 }))
    })

    await waitFor(() => {
      expect(view!.tasks.map((t) => t.status)).toEqual(['failed', 'done', 'done'])
    })
  })

  it('submitFiles 空数组零副作用；openPicker 无挂载 input 时安全 no-op', async () => {
    renderHarness(false)
    await waitFor(() => expect(view).not.toBeNull())
    act(() => {
      view!.submitFiles([], 0)
      view!.openPicker()
    })
    expect(view!.tasks).toHaveLength(0)
    expect(posts).toHaveLength(0)
  })
})

describe('W3 秒传探针：队列层接线（真 adapter 注入假 subtle/fake fetch）', () => {
  const hit201 = (id: number) =>
    jsonResponse(201, {
      id,
      folder_id: 3,
      original_name: 'dup.txt',
      object_key: 'blobs/000000',
      size: 7,
      content_type: 'text/plain',
      created_at: '2026-11-26T00:00:00Z',
    })

  it('命中(201) → 零字节：files POST 绝不发生；探针期间行 queued 0%（无新状态）；done 后双失效恰一次', async () => {
    renderHarness(true)
    stubSubtle()
    await waitFor(() => expect(view).not.toBeNull())
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    instantResponses = ['gate']

    act(() => {
      view!.submitFiles([fileNamed('dup.txt')], 3)
    })
    await waitFor(() => expect(instantRequests).toHaveLength(1))
    // 探针入参=后端 instantFileRequest 形状；假 subtle → 64 位小写 hex
    expect(instantRequests[0]!.body).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      original_name: 'dup.txt',
      content_type: 'text/plain',
      folder_id: 3,
    })
    // 哈希/探针期间：任务保持 queued 0%，busy 不计（builder-check 裁定：不新增状态）
    expect(view!.tasks[0]).toMatchObject({ status: 'queued', percent: 0 })
    expect(view!.busy).toBe(false)

    act(() => {
      instantRequests[0]!.resolve(hit201(77))
    })
    await waitFor(() => expect(view!.tasks[0]?.status).toBe('done'))
    expect(view!.tasks[0]?.instant).toBe(true)
    expect(posts).toHaveLength(0) // 零字节：直传请求从未发出
    expect(invalidateSpy).toHaveBeenCalledTimes(2) // done 仅一次 → ['files']+['usage'] 各一
    expect(await screen.findByText('已上传 1 个文件。')).toBeInTheDocument() // 批尾 toast 权威
    // 队列行内「⚡秒传」徽标（不另弹秒传 toast）
    expect(screen.getByTestId('instant-badge')).toHaveTextContent('⚡秒传')
    expect(screen.queryByText('秒传成功')).toBeNull()
  })

  it('探针期间取消 → cancelled + 新文案「上传已取消。」（W3 有意变更钉测）；迟到 201 不再动行、零直传', async () => {
    renderHarness(true)
    stubSubtle()
    await waitFor(() => expect(view).not.toBeNull())
    instantResponses = ['gate']

    act(() => {
      view!.submitFiles([fileNamed('dup.txt')], 0)
    })
    await waitFor(() => expect(instantRequests).toHaveLength(1))
    // 探针期间任务仍是 queued → 面板 queued 行的取消按钮即探针期取消入口
    expect(view!.tasks[0]?.status).toBe('queued')
    act(() => {
      screen.getByRole('button', { name: '取消' }).click()
    })
    await waitFor(() => expect(view!.tasks[0]?.status).toBe('cancelled'))
    expect(await screen.findByText('上传已取消。')).toBeInTheDocument()

    act(() => {
      instantRequests[0]!.resolve(hit201(77)) // 迟到的命中结果必须被丢弃
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(view!.tasks[0]?.status).toBe('cancelled') // 不再转 done
    expect(posts).toHaveLength(0)
    expect(screen.queryByText('已上传 1 个文件。')).toBeNull() // halted：批尾 toast 不出
  })

  it('批内混合（hit+miss）：批尾 toast 仍权威且仅一条「已上传 2 个文件。」；徽标只挂命中行', async () => {
    renderHarness(true)
    stubSubtle()
    await waitFor(() => expect(view).not.toBeNull())
    instantResponses = [hit201(88)] // 第一探针命中；第二回退默认 miss

    act(() => {
      view!.submitFiles([fileNamed('dup.txt'), fileNamed('fresh.txt')], 3)
    })
    await waitForPosts(1) // dup 命中零字节 → fresh 未命中 → 正常直传开播
    expect(instantRequests).toHaveLength(0) // 无 gate：两次探针都已自动应答
    act(() => {
      posts[0]!.resolve(jsonResponse(200, { id: 89 }))
    })
    await waitFor(() => {
      expect(view!.tasks.map((t) => t.status)).toEqual(['done', 'done'])
    })
    expect(screen.getAllByTestId('instant-badge')).toHaveLength(1) // 仅命中行有徽标
    expect(await screen.findByText('已上传 2 个文件。')).toBeInTheDocument()
    expect(screen.getAllByText('已上传 2 个文件。')).toHaveLength(1) // 无第二条秒传 toast
  })

  it('未命中(200 exists:false) → 直传与旧行为逐字段一致，无徽标', async () => {
    renderHarness(true)
    stubSubtle()
    await waitFor(() => expect(view).not.toBeNull())
    act(() => {
      view!.submitFiles([fileNamed('a.txt')], 0)
    })
    await waitForPosts(1)
    act(() => {
      posts[0]!.resolve(jsonResponse(200, { id: 9 }))
    })
    await waitFor(() => expect(view!.tasks[0]?.status).toBe('done'))
    expect(view!.tasks[0]?.instant).toBeUndefined()
    expect(screen.queryByTestId('instant-badge')).toBeNull()
    expect(await screen.findByText('已上传 1 个文件。')).toBeInTheDocument()
  })
})

describe('Attachment 行：状态文案与操作可用性', () => {
  const base = { id: 'r1', name: 'big.bin', size: 49 * 1024 * 1024, percent: 57 }

  function row(status: UploadTask['status'], extra: Partial<UploadTask> = {}): UploadTask {
    return { ...base, status, ...extra }
  }

  it('merging 不提供取消入口（旧 544 行「合并阶段不可取消」的 UI 半；runUpload 层忽略信号为另一半）', () => {
    render(<Attachment task={row('merging')} onCancel={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText('big.bin')).toBeInTheDocument()
    expect(screen.getByText('49.0 MB')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '57')
    expect(screen.getByText(/正在合并/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('T13 carry #11（Minor-6）：直传（<49MiB）进行中无取消钮（旧版直传无中止通道，点击空转）；queued 出队仍有效', () => {
    const small: UploadTask = { id: 'r9', name: 'small.txt', size: 1024, percent: 40, status: 'uploading' }
    const { unmount } = render(<Attachment task={small} onCancel={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText(/上传中/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
    unmount()

    render(<Attachment task={{ ...small, status: 'queued', percent: 0 }} onCancel={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument() // 出队=真有效，保留
  })

  it('uploading/queued 可取消（分片行 size≥49MiB）；failed 显错误文案 + 重试且无取消；done 无操作', () => {
    const { unmount } = render(<Attachment task={row('uploading')} onCancel={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    unmount()

    render(<Attachment task={row('failed', { error: '云仓可用存储空间不足。', percent: 85 })} onCancel={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText(/上传失败：云仓可用存储空间不足。/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('W3 徽标：instant 行内显「⚡秒传」，普通 done 行不显（命中差异以徽标呈现，非 toast）', () => {
    const { unmount } = render(
      <Attachment
        task={{ id: 'r11', name: 'dup.txt', size: 1024, percent: 100, status: 'done', instant: true }}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByTestId('instant-badge')).toHaveTextContent('⚡秒传')
    unmount()
    render(<Attachment task={{ id: 'r12', name: 'norm.txt', size: 1024, percent: 100, status: 'done' }} onCancel={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.queryByTestId('instant-badge')).toBeNull()
  })

  it('重试/取消回调接线到按钮', async () => {
    const onCancel = vi.fn()
    const onRetry = vi.fn()
    const { rerender } = render(<Attachment task={row('queued', { percent: 0 })} onCancel={onCancel} onRetry={onRetry} />)
    screen.getByRole('button', { name: '取消' }).click() // queued 也可取消（出队）
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<Attachment task={row('cancelled')} onCancel={onCancel} onRetry={onRetry} />)
    screen.getByRole('button', { name: '重试' }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('UploadQueuePanel 头部目标目录（T13 carry #12 / Minor-7）', () => {
  it('搜索/trash 态落根上传：头部显「保存到：根目录」，不再静默', async () => {
    renderHarness(true)
    await waitFor(() => expect(view).not.toBeNull())
    act(() => {
      view!.submitFiles([fileNamed('a.txt')], 0)
    })
    expect(await screen.findByTestId('upload-target')).toHaveTextContent('保存到：根目录')
    act(() => posts[0]?.resolve(jsonResponse(200, { id: 1 }))) // 收尾放行，不留悬挂 POST
  })

  it('非根目标：navTrail 缓存命中（TopBar 暖链契约）→ 显尾项名', async () => {
    renderHarness(true)
    queryClient.setQueryData(['navTrail', 3], [
      { id: 0, name: '根目录' },
      { id: 3, name: '照片' },
    ])
    await waitFor(() => expect(view).not.toBeNull())
    act(() => {
      view!.submitFiles([fileNamed('a.txt')], 3)
    })
    expect(await screen.findByTestId('upload-target')).toHaveTextContent('保存到：照片')
    act(() => posts[0]?.resolve(jsonResponse(200, { id: 2 })))
  })

  it('冷缓存兜底按 TopBar 面包屑同款「目录 <id>」占位，不静默不造假名', async () => {
    renderHarness(true)
    await waitFor(() => expect(view).not.toBeNull())
    act(() => {
      view!.submitFiles([fileNamed('a.txt')], 9)
    })
    expect(await screen.findByTestId('upload-target')).toHaveTextContent('保存到：目录 9')
    act(() => posts[0]?.resolve(jsonResponse(200, { id: 3 })))
  })
})
