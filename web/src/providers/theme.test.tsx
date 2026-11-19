import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from '@/providers/theme'

function Probe() {
  const { theme, toggle } = useTheme()
  return (
    <button type="button" onClick={toggle}>
      theme:{theme}
    </button>
  )
}

describe('ThemeProvider（.dark 挂 <html> + localStorage acs.theme，默认暗色）', () => {
  afterEach(() => {
    cleanup()
    localStorage.removeItem('acs.theme')
    document.documentElement.classList.add('dark')
  })

  it('默认暗色；toggle 后去 .dark、持久化 light；重挂载从存储恢复（模拟刷新）', async () => {
    const view = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByRole('button')).toHaveTextContent('theme:dark')

    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('theme:light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('acs.theme')).toBe('light')

    view.unmount()
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('theme:light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
