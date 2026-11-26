// 路由守卫纯函数（Task 4）：对应旧 Vue 版 router.beforeEach 的 requiresAuth/guestOnly 逻辑。
// 决策值既是布尔放行标记，也是重定向目标路径，供 routes/index.tsx 的 middleware 直接喂 redirect()。

export interface RouteGuardMeta {
  requiresAuth?: boolean
  guestOnly?: boolean
  /** 公开路由（Task A7 访客下载页 /d/:token）：登录与否一律放行，无需会话即可直达。 */
  public?: boolean
}

export type GuardDecision = true | '/login' | '/'

export function canAccess(meta: RouteGuardMeta, authed: boolean): GuardDecision {
  // public 最先短路：访客页对任意会话状态可达。
  // public 与 requiresAuth/guestOnly 并存属配置错误（实际不存在），此序仅保证决策函数对任意输入总有确定结果。
  if (meta.public) return true
  // requiresAuth 与 guestOnly 同时出现时 requiresAuth 优先短路（旧 router 亦按 meta.requiresAuth 先判；
  // 二者并存的 meta 实际不存在，此分支仅保证决策函数对任意输入总有一个确定结果）
  if (meta.requiresAuth) return authed ? true : '/login'
  if (meta.guestOnly) return authed ? '/' : true
  return true
}
