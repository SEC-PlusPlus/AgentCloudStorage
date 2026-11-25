// /d/:token 访客下载页（Task A7，spec §1.2 生命周期 + §3 v2 状态码矩阵）：免登录公开路由（guard meta public）。
// 生命周期：挂载 getShareMeta → loading / 404 不存在 / 410 reason 三文案 / needs_password 表单 /
// 开放直下；表单 verify 200 后 share_token 只存组件态（不落存储、不进 URL 之外路径），下载按钮换成
// ?access=<share_token> 的 <a download>（Content-Disposition 由后端负责，浏览器直接落盘）。
// 文案映射收敛在本页（reason→访客文案是展示语义，见 shares.ts 红线③）；配色/组件与 LoginRoute 同源
// （GlassCard/Field/Button/Text + @glinui/tokens CSS 变量），不新增设计系统。
// data-testid="share-route" 与 files-route/login-route 同锚点约定；下载链接另有 testid 供 href 断言。
import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { ApiError } from '@/api/client'
import { getShareMeta, shareDownloadUrl, verifySharePassword, ShareMetaError, type ShareMeta } from '@/api/shares'
import { Button } from '@/components/glinui/components/button'
import { GlassCard, GlassCardContent, GlassCardHeader } from '@/components/glinui/components/glass-card'
import { Heading } from '@/components/glinui/components/heading'
import { Input } from '@/components/glinui/components/input'
import { Text } from '@/components/glinui/components/text'
import { Field } from '@/components/app/Field'
import { formatBytes, formatDate } from '@/lib/format'

type ViewState =
  | { stage: 'loading' }
  | { stage: 'failed'; title: string; description: string }
  | { stage: 'password'; meta: ShareMeta }
  | { stage: 'ready'; meta: ShareMeta }

// spec §3：410 的 reason（revoked/expired/file_unavailable）对访客可见（持 token 即凭证，无枚举面）。
const GONE_TITLE: Record<string, string> = {
  revoked: '链接已被撤销',
  expired: '链接已过期',
  file_unavailable: '文件暂不可用',
}

function metaFailure(error: unknown): ViewState {
  if (error instanceof ShareMetaError) {
    if (error.status === 404) {
      return { stage: 'failed', title: '链接不存在', description: '链接可能不完整，请向分享者重新获取。' }
    }
    if (error.status === 410) {
      // 理由：reason 为 null/未知取值时兜底「链接已失效」（brief Step 3 的 410 总文案）。
      return { stage: 'failed', title: GONE_TITLE[error.reason ?? ''] ?? '链接已失效', description: '该分享链接当前不可用。' }
    }
    if (error.status === 0) {
      return { stage: 'failed', title: '无法连接服务器', description: '请检查网络后刷新重试。' }
    }
  }
  return { stage: 'failed', title: '链接暂时无法访问', description: '请稍后刷新重试。' }
}

export function ShareRoute() {
  const { token = '' } = useParams<{ token: string }>()
  const [view, setView] = useState<ViewState>({ stage: 'loading' })
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    // StrictMode 下 effect 双跑，cancelled 旗标防旧请求覆盖新状态。
    let cancelled = false
    setView({ stage: 'loading' })
    getShareMeta(token)
      .then((meta) => {
        if (cancelled) return
        setView(meta.needs_password ? { stage: 'password', meta } : { stage: 'ready', meta })
      })
      .catch((error: unknown) => {
        if (!cancelled) setView(metaFailure(error))
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return // 双保险同 LoginForm：按钮 disabled 之外拦程序化连击提交
    setPending(true)
    setPasswordError(null)
    try {
      const result = await verifySharePassword(token, password)
      setShareToken(result.share_token) // share JWT 只存组件态：不落 sessionStorage/localStorage
      setView((current) => (current.stage === 'password' ? { stage: 'ready', meta: current.meta } : current))
    } catch (error) {
      // spec §3：verify 401=invalid_password（密码错）、429=按 IP+token 5 次/10min 限流。
      const status = error instanceof ApiError ? error.status : 0
      setPasswordError(
        status === 401 ? '密码错误。' : status === 429 ? '尝试次数过多，请稍后再试。' : '验证失败，请稍后重试。',
      )
    } finally {
      setPending(false)
    }
  }

  const meta = view.stage === 'password' || view.stage === 'ready' ? view.meta : null

  return (
    <main data-testid="share-route" className="flex min-h-full flex-col items-center justify-center p-4">
      <GlassCard data-testid="share-card" className="w-full max-w-[480px]">
        <GlassCardHeader className="flex flex-col items-center gap-2 text-center">
          <Heading level={1} size="md">
            云仓分享
          </Heading>
          {meta ? (
            <div className="flex flex-col items-center gap-1">
              <Heading level={2} size="sm">
                {meta.display_name}
              </Heading>
              <Text variant="muted" size="sm">
                {formatBytes(meta.size)}
              </Text>
              {meta.content_type ? (
                <Text variant="muted" size="sm">
                  {meta.content_type}
                </Text>
              ) : null}
              {meta.expires_at ? (
                <Text variant="muted" size="sm">
                  {formatDate(meta.expires_at)} 前有效
                </Text>
              ) : null}
            </div>
          ) : null}
        </GlassCardHeader>

        <GlassCardContent className="pt-2">
          {view.stage === 'loading' ? (
            <Text variant="muted">加载中…</Text>
          ) : null}

          {view.stage === 'failed' ? (
            <div role="alert" className="flex flex-col items-center gap-1 py-2 text-center">
              <Heading level={2} size="sm">
                {view.title}
              </Heading>
              <Text variant="muted" size="sm">
                {view.description}
              </Text>
            </div>
          ) : null}

          {view.stage === 'password' ? (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <Field id="share-password" label="访问密码" error={passwordError ?? undefined}>
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    required
                    autoFocus
                    autoComplete="current-password"
                    placeholder="输入分享密码"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" variant="liquid" disabled={pending} className="w-full">
                验证
              </Button>
            </form>
          ) : null}

          {view.stage === 'ready' ? (
            // <a download>：href 由 shareDownloadUrl 生成——密码链接必带 ?access=<share_token>；
            // 文件名/attachment 由后端 Content-Disposition 负责，download 属性仅提示浏览器另存。
            <Button asChild variant="liquid" className="w-full">
              <a data-testid="share-download" href={shareDownloadUrl(token, shareToken)} download>
                下载文件
              </a>
            </Button>
          ) : null}
        </GlassCardContent>
      </GlassCard>
    </main>
  )
}
