// 路由表（Task 4）：/login(guestOnly) /files(requiresAuth) /trash(requiresAuth) / 与 * 重定向 /files。
// 偏离说明：计划按 react-router v7 写 beforeLoad + to.meta；实际装的是 v8.5.1，
// RouteObject 已无 beforeLoad，官方替代品是 route `middleware`（同一时机：每次导航、渲染与 loader 之前）。
// 守卫逻辑仍收敛为纯函数 canAccess（guard.ts），此处只做接线，changelog 已记此偏离。
import { createBrowserRouter, redirect, type MiddlewareFunction, type RouteObject } from 'react-router'
import { isAuthenticated, useAuth } from '@/stores/auth'
import { AppLayout } from './AppLayout'
import { canAccess, type RouteGuardMeta } from './guard'
import { LoginRoute } from './LoginRoute'

// 用闭包携带 meta 而非 v7 的 to.meta：v8 middleware args 不含 handle/meta，
// canAccess 的入参形状不变，守卫语义与旧 Vue 版 router.beforeEach 对齐。
function authGuard(meta: RouteGuardMeta): MiddlewareFunction {
  return (_args, next) => {
    const decision = canAccess(meta, isAuthenticated(useAuth.getState()))
    if (decision !== true) return redirect(decision)
    return next()
  }
}

export const routeObjects: RouteObject[] = [
  {
    path: '/login',
    element: <LoginRoute />,
    middleware: [authGuard({ guestOnly: true })],
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, loader: () => redirect('/files') },
      {
        path: 'files',
        element: <div data-testid="files-route">文件工作台占位（Task 6 实现）</div>,
        middleware: [authGuard({ requiresAuth: true })],
      },
      {
        path: 'trash',
        element: <div data-testid="trash-route">回收站占位（Task 7 实现）</div>,
        middleware: [authGuard({ requiresAuth: true })],
      },
      { path: '*', loader: () => redirect('/files') },
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routeObjects)
}
