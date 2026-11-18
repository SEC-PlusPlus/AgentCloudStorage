// 移植自旧 Vue 版 web/src/stores/auth.ts（历史提交 adbcfba）：vue ref/computed → zustand，
// sessionStorage 三键名与旧版逐字节一致（acs.access-token / acs.expires-at / acs.user）。
import { create } from 'zustand'
import type { UserProfile } from '@/api/auth'

const TOKEN_KEY = 'acs.access-token'
const EXPIRES_KEY = 'acs.expires-at'
const USER_KEY = 'acs.user'

export interface AuthState {
  token: string
  expiresAt: string
  user: UserProfile | null
}

function clearStoredSession(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(EXPIRES_KEY)
  sessionStorage.removeItem(USER_KEY)
}

function restoreSession(): AuthState | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY)
    const expiresAt = sessionStorage.getItem(EXPIRES_KEY)
    const rawUser = sessionStorage.getItem(USER_KEY)
    if (!token || !expiresAt || !rawUser || Date.parse(expiresAt) <= Date.now()) {
      clearStoredSession()
      return null
    }
    return { token, expiresAt, user: JSON.parse(rawUser) as UserProfile } // 理由：存储的 JSON 无静态形状，按约定类型收窄
  } catch {
    clearStoredSession()
    return null
  }
}

const emptySession: AuthState = { token: '', expiresAt: '', user: null }

export const useAuth = create<AuthState>(() => restoreSession() ?? emptySession)

export const authActions = {
  setSession(nextToken: string, nextExpiry: string, nextUser: UserProfile): void {
    useAuth.setState({ token: nextToken, expiresAt: nextExpiry, user: nextUser })
    sessionStorage.setItem(TOKEN_KEY, nextToken)
    sessionStorage.setItem(EXPIRES_KEY, nextExpiry)
    sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser))
  },
  clear(): void {
    useAuth.setState(emptySession)
    clearStoredSession()
  },
}

export function isAuthenticated(state: AuthState): boolean {
  return Boolean(state.token && Date.parse(state.expiresAt) > Date.now())
}

// api 层非 hook 读取（对应旧版 token() / auth.token.value）。
export function getToken(): string {
  return useAuth.getState().token
}
