// 应用外壳占位（Task 4）：Outlet + 固定背景层 + 401 接线（Review Focus #1）。
// 背景为 @glinui/tokens 变量的 CSS 占位（R-T4-a2）：TODO(Task 2/6 swap) 换成 vendored
// AuroraBackground + DotPattern 组件；本任务禁止 import 尚不存在的 @/components/glinui。
import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { setUnauthorizedHandler } from '@/api/client'
import { authActions } from '@/stores/auth'
import { useTheme } from '@/providers/theme'

export function AppLayout() {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()

  useEffect(() => {
    // 401 接线：request/fileContentResponse 的 401 分支 → 清会话 → toast → 跳 /login。
    // 挂载注册、卸载反注册（null），避免登录页等外壳外组件残留旧 navigate。
    setUnauthorizedHandler(() => {
      authActions.clear()
      toast('登录已过期')
      navigate('/login')
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  return (
    <div className="relative flex min-h-full flex-col">
      {/* TODO(Task 2/6 swap): vendored AuroraBackground（aurora-background） */}
      <div aria-hidden className="aurora-placeholder fixed inset-0 -z-10" />
      {/* TODO(Task 2/6 swap): vendored DotPattern（dot-pattern） */}
      <div aria-hidden className="dot-pattern-placeholder fixed inset-0 -z-10 opacity-40" />

      <header className="flex items-center justify-between gap-3 px-6 py-4">
        <span className="text-sm font-medium text-[var(--color-foreground)]">ACS 个人云存储</span>
        {/* 主题切换占位入口：Navbar 落地（Task 6）后移入导航条，此处仅 dev 手测持久化用 */}
        <button
          type="button"
          onClick={toggle}
          className="rounded-[var(--radius-md)] border border-[var(--glass-border)] bg-[var(--glass-2-surface)] px-3 py-1 text-sm text-[var(--color-foreground)]"
        >
          切换主题（当前：{theme === 'dark' ? '暗色' : '亮色'}）
        </button>
      </header>

      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
