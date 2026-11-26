// 分享访客侧公开 API（Task A7 / fix-round1，spec §3）：/api/v1/public/shares/* 全部免登录。
// 红线：
// ①不读 stores/auth，fetch 一律不带 Authorization——访客链路（meta 与 verify 两路）绝不携带用户登录 JWT；
//   fix 评审 MINOR-1：verify 也移出 client.request（见红线③），公开链路对 auth 侧代码路径零牵连，
//   自然也不触发 client.ts:46 的 401→登出分支；
//   W1 注：本文件自此含访客/属主两段——红线①仅约束上方访客段（publicRequest 及三个导出函数）；
//   属主段见文件尾分隔注释，全走 client.request 携带用户 JWT（spec §7「两模块共文件不同函数，注释分区」）。
// ②下载走 ?access=<share_token>（share scope JWT），浏览器可直接导航/另存；
// ③meta 与 verify 都可能返回 spec §3 的结构化错误体（410 带 reason：revoked/expired/file_unavailable；
//   404=not_found）。client.ApiError 只有 message/status 装不下 reason，故公开链路自带最小 fetch
//   （publicRequest）抛 SharePublicError(status+reason)；访客文案映射收敛在 ShareRoute（本页唯一消费者）。
import { ApiError, request } from '@/api/client'
import { getToken } from '@/stores/auth'

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

// ═══════════════════════════════════════════════════════════════════════════
// 属主段（Task W1 / W 轨 spec §2）：POST /api/v1/files/:id/shares · GET /api/v1/shares ·
// DELETE /api/v1/shares/:token（router.go:62-64，protected 组）。一律走 client.request 携带用户
// JWT（getToken 同 storage.ts 惯例），401 走 client 的登出分支——与上方访客段红线①互不牵连。
// ═══════════════════════════════════════════════════════════════════════════

/** 与后端 shareResponse 逐字段一致（share_handler.go:65——线上无 id 字段，token 即主键载体）。 */
export interface ShareItem {
  token: string
  canonical_url: string
  display_name: string
  expires_at: string | null
  download_count: number
  revoked: boolean
  created_at: string
  has_password: boolean
}

/** 创建选项：expires_in 秒数（省略=永久）；password 省略=无访问密码（后端指针语义，前端不发明字段）。 */
export interface ShareCreateOptions {
  password?: string
  expires_in?: number
}

export function createShare(fileId: number, opts: ShareCreateOptions = {}): Promise<ShareItem> {
  const body: ShareCreateOptions = {}
  if (opts.password !== undefined) body.password = opts.password
  if (opts.expires_in !== undefined) body.expires_in = opts.expires_in
  return request<ShareItem>(
    `/api/v1/files/${fileId}/shares`,
    { method: 'POST', body: JSON.stringify(body) },
    getToken(),
  )
}

export function listShares(): Promise<{ items: ShareItem[] }> {
  return request<{ items: ShareItem[] }>('/api/v1/shares', {}, getToken())
}

/** 撤销=204（request 对 204 返回 undefined）；重复撤销幂等由服务端负责。 */
export function revokeShare(token: string): Promise<void> {
  return request<void>(`/api/v1/shares/${encodeURIComponent(token)}`, { method: 'DELETE' }, getToken())
}

/** 属主分享落地页 URL（访客路由 /d/:token，routes/index.tsx 已注册）。token 原样拼入（服务端生成即 URL-safe）。 */
export function shareUrl(token: string): string {
  return `${window.location.origin}/d/${token}`
}
