// 主题 Provider（Task 4）：`.dark` 挂 <html>（@glinui/tokens 的暗色开关），localStorage `acs.theme` 持久化，默认暗色。
// index.html 已预置 class="dark"，首屏无闪烁；ThemeProvider 挂载后按存储值同步。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const THEME_KEY = 'acs.theme'

export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // 理由：隐私模式/禁用存储时 localStorage 访问会抛错，回落默认暗色即可
  }
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // 理由：存储不可用时仅本次会话生效，不阻塞 UI
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}
