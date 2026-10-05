import { computed, ref } from 'vue'
import type { UserProfile } from '../api/auth'

const TOKEN_KEY = 'acs.access-token'
const EXPIRES_KEY = 'acs.expires-at'
const USER_KEY = 'acs.user'

function restoreSession(): { token: string; expiresAt: string; user: UserProfile } | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY)
    const expiresAt = sessionStorage.getItem(EXPIRES_KEY)
    const rawUser = sessionStorage.getItem(USER_KEY)
    if (!token || !expiresAt || !rawUser || Date.parse(expiresAt) <= Date.now()) {
      clearStoredSession()
      return null
    }
    return { token, expiresAt, user: JSON.parse(rawUser) as UserProfile }
  } catch {
    clearStoredSession()
    return null
  }
}

function clearStoredSession() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(EXPIRES_KEY)
  sessionStorage.removeItem(USER_KEY)
}

const initial = restoreSession()
const token = ref(initial?.token ?? '')
const expiresAt = ref(initial?.expiresAt ?? '')
const user = ref<UserProfile | null>(initial?.user ?? null)

export const auth = {
  token: computed(() => token.value),
  user: computed(() => user.value),
  isAuthenticated: computed(() => Boolean(token.value && Date.parse(expiresAt.value) > Date.now())),
  setSession(nextToken: string, nextExpiry: string, nextUser: UserProfile) {
    token.value = nextToken
    expiresAt.value = nextExpiry
    user.value = nextUser
    sessionStorage.setItem(TOKEN_KEY, nextToken)
    sessionStorage.setItem(EXPIRES_KEY, nextExpiry)
    sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser))
  },
  clear() {
    token.value = ''
    expiresAt.value = ''
    user.value = null
    clearStoredSession()
  },
}
