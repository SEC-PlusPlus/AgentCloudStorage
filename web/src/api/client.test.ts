import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, request, setUnauthorizedHandler, translateError } from '@/api/client'

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(() => undefined)
})

describe('translateError（旧 client.ts:43-71 逐条移植 + 413/507 并入）', () => {
  const cases: Array<readonly [raw: string, status: number, expected: string]> = [
    ['invalid email or password', 401, '邮箱或密码不正确。'],
    ['too many login attempts', 429, '登录尝试过于频繁，请稍后重试（最多约 10 分钟）。'],
    ['login temporarily unavailable', 503, '登录服务暂时不可用，请稍后重试。'],
    ['folder already exists in target', 409, '目标目录中已存在同名文件夹。'],
    ['folder already exists', 409, '当前目录中已存在同名文件夹。'],
    ['username or email already exists', 409, '用户名或邮箱已被使用。'],
    ['username must be between 3 and 32', 400, '用户名长度需要在 3 到 32 个字符之间。'],
    ['invalid email address', 400, '请输入有效的邮箱地址。'],
    ['password must be at least 8 characters', 400, '密码至少 8 个字符，且不能超过 72 字节。'],
    ['folder is not empty', 409, '文件夹内仍有文件或子文件夹；回收站中的文件也算在内。请先移走或永久删除相关内容。'],
    ['invalid folder move', 400, '不能将文件夹移动到自身或其子目录中。'],
    ['target folder not found', 404, '目标文件夹不存在或已被删除。'],
    ['file not found in trash', 404, '回收站中的文件不存在或已被处理。'],
    ['upload session not found', 404, '这次上传已失效或过期，请重新选择文件开始上传。'],
    ['upload parts are incomplete', 400, '文件分片尚未全部上传，请重试未完成的分片。'],
    ['upload session is not active', 409, '这次上传已结束或失效，请重新选择文件。'],
    ['part is too large', 400, '上传分片超过服务端限制，请重试。'],
    ['invalid part number or size', 400, '上传分片信息不匹配，请重新选择文件续传。'],
    ['upload completion is pending', 409, '文件正在完成合并，请稍后重试或刷新文件列表。'],
    ['invalid search keyword', 400, '请输入有效的搜索关键词。'],
    ['invalid register request', 400, '请检查注册信息是否完整。'],
    ['invalid login request', 400, '请填写邮箱和密码。'],
    ['user is disabled', 403, '此账号暂不可用，请联系管理员。'],
    ['totally unknown upstream failure', 500, '服务暂时遇到问题，请稍后重试。'],
    ['totally unknown conflict', 409, '操作冲突，请刷新后重试。'],
    ['storage quota exceeded', 400, '云仓可用存储空间不足。'],
    // 旧 FileWorkbench.vue:111-112 按 status 本地覆盖的两条文案并入后，status 优先于原文匹配
    ['file is too large', 413, '文件过大，单次上传约支持 50 MiB 以内的文件。'],
    ['storage quota exceeded', 507, '云仓可用存储空间不足。'],
    ['unrelated body', 413, '文件过大，单次上传约支持 50 MiB 以内的文件。'],
    ['unrelated body', 507, '云仓可用存储空间不足。'],
  ]

  cases.forEach(([raw, status, expected], index) => {
    it(`case ${index + 1}: [${status}] ${raw} → ${expected}`, () => {
      expect(translateError(raw, status)).toBe(expected)
    })
  })
})

describe('request', () => {
  it('非 2xx JSON error 体 → 映射后中文 ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'folder already exists' }),
    }))
    const error: unknown = await request('/api/v1/folders', { method: 'POST' }, 'tok').catch((e: unknown) => e)
    if (!(error instanceof ApiError)) throw new Error('expected ApiError')
    expect(error.name).toBe('ApiError')
    expect(error.status).toBe(400)
    expect(error.message).toBe('当前目录中已存在同名文件夹。')
  })

  it('非 JSON 错误体（nginx HTML 413）→ 按 status 的中文文案（旧 UI 同款，Task 3 评审强制项）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
    }))
    const error: unknown = await request('/api/v1/files', { method: 'POST' }, 'tok').catch((e: unknown) => e)
    if (!(error instanceof ApiError)) throw new Error('expected ApiError')
    expect(error.status).toBe(413)
    expect(error.message).toBe('文件过大，单次上传约支持 50 MiB 以内的文件。')
  })

  it('401 带 token → unauthorizedHandler 恰好调用一次；无 token 不调用', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    const unauthorized = { ok: false, status: 401, json: async () => ({ error: 'token expired' }) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorized))
    await request('/api/v1/files', {}, 'tok').catch(() => undefined)
    expect(handler).toHaveBeenCalledTimes(1)
    await request('/api/v1/auth/login', { method: 'POST', body: '{}' }).catch(() => undefined)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('204 → resolve undefined，且不读响应体', async () => {
    const json = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json }))
    await expect(request<void>('/api/v1/files/1', { method: 'DELETE' }, 'tok')).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })

  it('fetch reject → ApiError status 0 连接失败文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error: unknown = await request('/api/v1/storage/usage', {}, 'tok').catch((e: unknown) => e)
    if (!(error instanceof ApiError)) throw new Error('expected ApiError')
    expect(error.status).toBe(0)
    expect(error.message).toBe('无法连接到服务，请确认 Go 后端已启动。')
  })

  it('请求头拼装同旧版：JSON 体带 Content-Type、FormData 不带、token 加 Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await request('/api/v1/files', { method: 'POST', body: JSON.stringify({ a: 1 }) }, 'tok')
    const jsonCall = fetchMock.mock.calls[0]
    if (!jsonCall) throw new Error('fetch not called')
    const jsonHeaders = jsonCall[1]?.headers as Record<string, string> // 理由：request 内部拼装的是普通对象，测试侧按约定形状读取
    expect(jsonCall[0]).toBe('/api/v1/files')
    expect(jsonHeaders['Content-Type']).toBe('application/json')
    expect(jsonHeaders['Authorization']).toBe('Bearer tok')

    await request('/api/v1/files', { method: 'POST', body: new FormData() })
    const formCall = fetchMock.mock.calls[1]
    if (!formCall) throw new Error('fetch not called twice')
    const formHeaders = formCall[1]?.headers as Record<string, string> // 理由：同上，读取 request 拼装的普通对象头
    expect(formHeaders['Content-Type']).toBeUndefined()
    expect(formHeaders['Authorization']).toBeUndefined()
  })

  it('成功 2xx → 解析 JSON 返回 T', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ used_bytes: 42 }),
    }))
    await expect(request<{ used_bytes: number }>('/api/v1/storage/usage', {}, 'tok')).resolves.toEqual({ used_bytes: 42 })
  })
})
