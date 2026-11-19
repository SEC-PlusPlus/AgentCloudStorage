// 登录表单（Task 5 / spec §5.1）：mascot hero + Heading + Field(邮箱/密码) + liquid Button。
// 成功：authActions.setSession(login 响应字段) → navigate('/files')；
// 失败：双载体（spec §5.1「错误走 alert + toast」，控制端 2026-11-19 裁定）——
//   ①Field 下方 Alert(destructive) 常驻显示 ApiError.message；
//   ②toast.error 弹出同一文案（中文映射/限流等待时长已在 api 层完成）。
// 成功分支不加 toast。pending 期间按钮 disabled 防重复提交。注册入口按产品决策保持禁用（仅静态提示，无注册 UI 调用）。
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { login } from '@/api/auth'
import { Alert } from '@/components/glinui/components/alert'
import { BlurFade } from '@/components/glinui/components/blur-fade'
import { Button } from '@/components/glinui/components/button'
import { GlassCard, GlassCardContent, GlassCardFooter, GlassCardHeader } from '@/components/glinui/components/glass-card'
import { Heading } from '@/components/glinui/components/heading'
import { Input } from '@/components/glinui/components/input'
import { Field } from '@/components/app/Field'
import { GopherScene } from '@/components/app/GopherScene'
import { authActions } from '@/stores/auth'

export function LoginForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return // 双保险：按钮 disabled 之外的程序化提交（如 Enter 键连击）
    setPending(true)
    setErrorMessage(null)
    try {
      // trim 对齐旧 adbcfba AuthPage:19（终评修波 1）：粘贴邮箱常带首尾空格，
      // 不修剪会把 ' x@y ' 原样送达后端、误触「邮箱格式不正确」类文案。
      const session = await login(email.trim(), password)
      authActions.setSession(session.access_token, session.expires_at, session.user)
      navigate('/files')
    } catch (error) {
      // ApiError.message 已由 client.translateError 中文化（含「too many login attempts」等待时长文案）。
      // 双载体（spec §5.1 裁定）：内联 Alert 常驻 + toast.error 弹出同一文案。
      const message = error instanceof Error ? error.message : '登录失败，请稍后重试。'
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <GlassCard className="w-full max-w-[420px]">
      <GlassCardHeader className="flex flex-col items-center gap-2 text-center">
        <BlurFade duration={600} blur={10} yOffset={8}>
          <img
            src="/images/cloud-gopher-pixel.png"
            alt="土拨鼠吉祥物"
            width={72}
            height={72}
            className="h-[72px] w-[72px] [image-rendering:pixelated]"
          />
        </BlurFade>
        <Heading level={1} size="md">
          Agent 云仓
        </Heading>
      </GlassCardHeader>

      <GlassCardContent>
        <form className="flex flex-col gap-4 pt-2" onSubmit={handleSubmit}>
          <Field id="login-email" label="邮箱">
            {(control) => (
              <Input
                {...control}
                type="email"
                required
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field id="login-password" label="密码">
            {(control) => (
              <Input
                {...control}
                type="password"
                required
                autoComplete="current-password"
                maxLength={72}
                placeholder="输入你的密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>

          {errorMessage ? (
            <Alert variant="destructive" size="sm">
              {errorMessage}
            </Alert>
          ) : null}

          <Button type="submit" variant="liquid" disabled={pending} className="w-full">
            登录
          </Button>
        </form>
      </GlassCardContent>

      {/* T13 carry #22：品牌场景（旧 AuthPage StorageScene 的移植落位）=卡片下部带；
          mascot PNG 保留在 header（R(T5-mascot) 措辞随 spec §5.1 更新，见 changelog 13a 行）。 */}
      <GlassCardFooter className="flex flex-col items-center gap-2 pt-2 text-center">
        <GopherScene className="max-w-[360px]" />
        <p className="text-xs text-[var(--color-foreground)] opacity-60">注册暂未开放</p>
      </GlassCardFooter>
    </GlassCard>
  )
}
