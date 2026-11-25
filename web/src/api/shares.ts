// 分享访客侧公开 API（Task A7，spec §3）：/api/v1/public/shares/* 全部免登录。
// 三条红线：
// ①不读 stores/auth、request 第三参数一律缺省——访客链路绝不携带用户登录 JWT
//   （client.ts:46 的 401→登出分支也因 !token 不触发，密码错误不会踢掉已登录的浏览器会话）；
// ②下载走 ?access=<share_token>（share scope JWT），浏览器可直接导航/另存；
// ③meta 410 错误体携带结构化 reason（share_handler.go statusForShareError），client.ApiError 只有
//   message/status 装不下 reason，故 getShareMeta 自带最小 fetch 并抛 ShareMetaError(status+reason)；
//   访客文案映射（404/410-reason/网络失败）留在 ShareRoute，本页是唯一消费者。
import { ApiError, request } from '@/api/client'

export type ShareUnavailableReason = 'revoked' | 'expired' | 'file_unavailable'

/** spec §3 ShareMeta（访客视角），字段与 shareMetaResponse 逐一对应。 */
export interface ShareMeta {
  display_name: string
  size: number
  content_type: string
  needs_password: boolean
  expires_at: string | null
}

/** Verify 成功响应：share-access JWT（15min，scope=share）。 */
export interface ShareVerifyResponse {
  share_token: string
}

export class ShareMetaError extends ApiError {
  /** 仅 410 且后端 reason 可识别时有值；其余为 null，由调用方兜底文案。 */
  readonly reason: ShareUnavailableReason | null

  constructor(message: string, status: number, reason: ShareUnavailableReason | null) {
    super(message, status)
    this.name = 'ShareMetaError'
    this.reason = reason
  }
}

function sharePath(token: string): string {
  return `/api/v1/public/shares/${encodeURIComponent(token)}`
}

export async function getShareMeta(token: string): Promise<ShareMeta> {
  let response: Response
  try {
    // 裸 fetch、无 headers：这是「公开」的实现本身，测试按请求头断言不带 Authorization。
    response = await fetch(sharePath(token))
  } catch {
    throw new ShareMetaError('无法连接到服务。', 0, null)
  }
  if (!response.ok) {
    let reason: ShareUnavailableReason | null = null
    try {
      const body = (await response.json()) as { reason?: string } // 理由：错误体形状由 spec §3 约定，运行时不可静态校验
      if (body.reason === 'revoked' || body.reason === 'expired' || body.reason === 'file_unavailable') {
        reason = body.reason
      }
    } catch {
      // 非 JSON 错误体（如代理层 5xx HTML 页）：仅凭 status 走页面兜底文案。
    }
    throw new ShareMetaError('链接暂时无法访问。', response.status, reason)
  }
  return (await response.json()) as ShareMeta // 理由：响应形状由 spec §3 ShareMeta 契约约定
}

export function verifySharePassword(token: string, password: string): Promise<ShareVerifyResponse> {
  // request 不带 token 参数：verify 是公开端点（防爆破限流由服务端按 IP+token 5 次/10min 负责）。
  return request<ShareVerifyResponse>(`${sharePath(token)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

/** 下载 URL：无密码链接不带 access；密码链接必须带 ?access=<share_token>（handler 双认 query/Bearer）。 */
export function shareDownloadUrl(token: string, access?: string | null): string {
  const url = `${sharePath(token)}/download`
  return access ? `${url}?access=${encodeURIComponent(access)}` : url
}
