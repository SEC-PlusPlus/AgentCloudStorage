// 登录页（Task 5）：全屏 aurora + 居中登录卡（≤420px，LoginForm 内实现）。
// 背景用 vendored AuroraBackground（PATH B 编译件，纯渲染无浏览器 API 依赖）；
// 配色只引用 @glinui/tokens CSS 变量（规范 §4 禁色值字面量）。
// AppLayout 的 aurora 占位层 swap 属 Task 6（R-T4-a2），此处不回改。
// data-testid="login-route" 为 Task 4 401 接线测试锚点，保留。
import { AuroraBackground } from '@/components/glinui/components/aurora-background'
import { LoginForm } from '@/features/auth/LoginForm'

export function LoginRoute() {
  return (
    <main data-testid="login-route" className="relative flex min-h-full items-center justify-center p-4">
      <AuroraBackground
        className="-z-10"
        colors={['var(--color-accent)', 'var(--color-accent-foreground)', 'var(--color-surface)']}
        intensity={0.6}
      />
      <LoginForm />
    </main>
  )
}
