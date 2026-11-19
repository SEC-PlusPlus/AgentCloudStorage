// 应用根 Provider（Task 4）：QueryClient + Theme + Router + Toaster。
// router 可注入（测试用 createMemoryRouter）；默认 createBrowserRouter。
import { useMemo, type ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { createAppRouter } from '@/routes'
import { ThemeProvider } from './theme'

type AppRouter = ComponentProps<typeof RouterProvider>['router']

export function AppProviders({ router }: { router?: AppRouter }) {
  const queryClient = useMemo(() => new QueryClient(), [])
  const activeRouter = useMemo(() => router ?? createAppRouter(), [router])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={activeRouter} />
        {/* R-T4-a1：暂直挂 npm sonner；vendored glass toast 包装件（Task 2 vendor 后、Task 6 接入）
            将替换此处挂载点：https://glinui.com/r/toast 的 glass 版 Toaster */}
        <Toaster position="top-right" />
      </ThemeProvider>
    </QueryClientProvider>
  )
}
