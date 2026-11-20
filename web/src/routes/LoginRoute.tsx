// 登录页（Task 5 / Task 15 分屏改版）：全屏 aurora + 左场景右表单的分屏构图。
// Task 15（控制端裁定）：GopherScene「传邮件」品牌场景从卡片 footer 迁出到左侧独立场景列，
// 等比放大——lg+ 双栏（左 flex-1 max-w-[720px] 垂直居中 / 右卡片 480px），
// <lg 堆叠（场景在卡上，max-w-[480px]，卡片满宽），SVG viewBox 620×360 自然等比无拉伸。
// 背景用 vendored AuroraBackground（PATH B 编译件，纯渲染无浏览器 API 依赖），仍全屏垫在双列之下；
// 配色只引用 @glinui/tokens CSS 变量（规范 §4 禁色值字面量）。
// data-testid="login-route" 为 Task 4 401 接线测试锚点；data-testid="login-scene-col"
// 为 Task 15 分屏结构锚（场景列必须在 GlassCard 之外，见 login-flow 分屏用例）。
import { AuroraBackground } from '@/components/glinui/components/aurora-background'
import { GopherScene } from '@/components/app/GopherScene'
import { LoginForm } from '@/features/auth/LoginForm'

export function LoginRoute() {
  return (
    <main data-testid="login-route" className="relative flex min-h-full flex-col items-center justify-center gap-8 p-4 lg:flex-row lg:gap-16">
      <AuroraBackground
        className="-z-10"
        colors={['var(--color-accent)', 'var(--color-accent-foreground)', 'var(--color-surface)']}
        intensity={0.6}
      />
      <div data-testid="login-scene-col" className="flex w-full justify-center lg:max-w-[720px] lg:flex-1">
        <GopherScene className="max-w-[480px] lg:max-w-[720px]" />
      </div>
      <LoginForm />
    </main>
  )
}
