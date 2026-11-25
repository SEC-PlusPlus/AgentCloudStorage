// 分享访客侧公开 API（Task A7 / fix-round1，spec §3）：/api/v1/public/shares/* 全部免登录。
// 红线：
// ①不读 stores/auth，fetch 一律不带 Authorization——访客链路（meta 与 verify 两路）绝不携带用户登录 JWT；
//   fix 评审 MINOR-1：verify 也移出 client.request（见红线③），公开链路对 auth 侧代码路径零牵连，
//   自然也不触发 client.ts:46 的 401→登出分支；
// ②下载走 ?access=<share_token>（share scope JWT），浏览器可直接导航/另存；
// ③meta 与 verify 都可能返回 spec §3 的结构化错误体（410 带 reason：revoked/expired/file_unavailable；
//   404=not_found）。client.ApiError 只有 message/status 装不下 reason，故公开链路自带最小 fetch
//   （publicRequest）抛 SharePublicError(status+reason)；访客文案映射收敛在 ShareRoute（本页唯一消费者）。
import { ApiError } from '@/api/client'

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

/** meta/verify 公开端点的失败载体：status 驱动文案分支；reason 仅 410 且可识别时有值。 */
export class SharePublicError extends ApiError {
  readonly reason: ShareUnavailableReason | null

  constructor(message: string, status: number, reason: ShareUnavailableReason | null) {
    super(message, status)
    this.name = 'SharePublicError'
    this.reason = reason
  }
}

function sharePath(token: string): string {
  return `/api/v1/public/shares/${encodeURIComponent(token)}`
}

const GONE_REASONS: readonly string[] = ['revoked', 'expired', 'file_unavailable']

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    // init 只可能携带 Content-Type/body——绝不组装 Authorization。
    response = await fetch(path, init)
  } catch {
    throw new SharePublicError('无法连接到服务。', 0, null)
  }
  if (!response.ok) {
    let reason: ShareUnavailableReason | null = null
    try {
      const body = (await response.json()) as { reason?: string } // 理由：错误体形状由 spec §3 约定，运行时不可静态校验
      if (body.reason && GONE_REASONS.includes(body.reason)) {
        reason = body.reason as ShareUnavailableReason // 理由：includes 已收窄为 GONE_REASONS 成员
      }
    } catch {
      // 非 JSON 错误体（如代理层 5xx HTML 页）：仅凭 status 走页面兜底文案。
    }
    throw new SharePublicError('链接暂时无法访问。', response.status, reason)
  }
  return (await response.json()) as T // 理由：响应形状由 spec §3 契约约定，泛型不可运行时校验
}

export function getShareMeta(token: string): Promise<ShareMeta> {
  return publicRequest<ShareMeta>(sharePath(token))
}

export function verifySharePassword(token: string, password: string): Promise<ShareVerifyResponse> {
  // 公开端点（防爆破限流由服务端按 IP+token 5 次/10min 负责）；404/410 与 meta 同语义透传到页面。
  return publicRequest<ShareVerifyResponse>(`${sharePath(token)}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

/** 下载 URL：无密码链接不带 access；密码链接必须带 ?access=<share_token>（handler 双认 query/Bearer）。 */
export function shareDownloadUrl(token: string, access?: string | null): string {
  const url = `${sharePath(token)}/download`
  return access ? `${url}?access=${encodeURIComponent(access)}` : url
}
