import { auth } from '../stores/auth'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('无法连接到服务，请确认 Go 后端已启动。', 0)
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      auth.clear()
      window.dispatchEvent(new Event('acs:unauthorized'))
    }
    let message = '请求失败，请稍后重试。'
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = translateError(body.error, response.status)
    } catch {
      // Some errors (such as a proxy failure) do not return JSON.
    }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function translateError(error: string, status: number): string {
  if (error.includes('invalid email or password')) return '邮箱或密码不正确。'
  if (error.includes('too many login attempts')) return '登录尝试过于频繁，请稍后重试（最多约 10 分钟）。'
  if (error.includes('login temporarily unavailable')) return '登录服务暂时不可用，请稍后重试。'
  if (error.includes('folder already exists in target')) return '目标目录中已存在同名文件夹。'
  if (error.includes('folder already exists')) return '当前目录中已存在同名文件夹。'
  if (error.includes('username or email already exists')) return '用户名或邮箱已被使用。'
  if (error.includes('username must be between')) return '用户名长度需要在 3 到 32 个字符之间。'
  if (error.includes('invalid email address')) return '请输入有效的邮箱地址。'
  if (error.includes('password must be at least')) return '密码至少 8 个字符，且不能超过 72 字节。'
  if (error.includes('folder is not empty')) return '文件夹内仍有文件或子文件夹；回收站中的文件也算在内。请先移走或永久删除相关内容。'
  if (error.includes('invalid folder move')) return '不能将文件夹移动到自身或其子目录中。'
  if (error.includes('target folder not found')) return '目标文件夹不存在或已被删除。'
  if (error.includes('file not found in trash')) return '回收站中的文件不存在或已被处理。'
  if (error.includes('file is too large')) return '文件超过服务端单次上传大小限制（约 50 MiB）。'
  if (error.includes('upload session not found')) return '这次上传已失效或过期，请重新选择文件开始上传。'
  if (error.includes('upload parts are incomplete')) return '文件分片尚未全部上传，请重试未完成的分片。'
  if (error.includes('upload session is not active') || error.includes('upload session cannot be completed')) return '这次上传已结束或失效，请重新选择文件。'
  if (error.includes('part is too large')) return '上传分片超过服务端限制，请重试。'
  if (error.includes('invalid part number or size')) return '上传分片信息不匹配，请重新选择文件续传。'
  if (error.includes('upload completion is pending')) return '文件正在完成合并，请稍后重试或刷新文件列表。'
  if (error.includes('storage quota exceeded')) return '云仓可用存储空间不足。'
  if (error.includes('invalid search keyword')) return '请输入有效的搜索关键词。'
  if (status === 409) return '操作冲突，请刷新后重试。'
  if (error.includes('invalid register request')) return '请检查注册信息是否完整。'
  if (error.includes('invalid login request')) return '请填写邮箱和密码。'
  if (error.includes('user is disabled')) return '此账号暂不可用，请联系管理员。'
  return '服务暂时遇到问题，请稍后重试。'
}
