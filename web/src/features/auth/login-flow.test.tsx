// 登录流程（Task 5 / brief Step 1，mock `login` 于 api 模块层）：
// ①成功：authActions.setSession(login 响应字段) + navigate('/files')（sessionStorage/store/路由三重证据）；
// ②失败：ApiError.message 中文文案经 Alert(role=alert) 可见、会话未写、不跳转；
// ③限流：translateError 命中「too many login attempts」的等待时长文案原样显示；
// ④pending：请求未决时按钮 disabled，二次点击不重复提交。
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { login, type LoginResponse } from '@/api/auth'
import { ApiError, translateError } from '@/api/client'
import { AppProviders } from '@/providers/AppProviders'
import { routeObjects } from '@/routes'
import { authActions, useAuth } from '@/stores/auth'

vi.mock('@/api/auth', () => ({ login: vi.fn() })) // register 未被登录链路 import，桩仅补 login
const loginMock = vi.mocked(login)

const TOKEN_KEY = 'acs.access-token'
const EXPIRES_KEY = 'acs.expires-at'
const USER_KEY = 'acs.user'

const sessionResponse: LoginResponse = {
  access_token: 'tok-2026',
  token_type: 'bearer',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 1, username: 'tester', email: 'tester@example.com', created_at: '2026-01-01T00:00:00Z' },
}

async function renderLoginPage() {
  const router = createMemoryRouter(routeObjects, { initialEntries: ['/login'] })
  render(<AppProviders router={router} />)
  await screen.findByTestId('login-route')
  return router
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('邮箱'), 'tester@example.com')
  await user.type(screen.getByLabelText('密码'), 'hunter2hunter2')
  // 点击包进 async act：login 的 promise 续体（setPending/setErrorMessage/navigate）全部在 act 内 flush，
  // 否则 React 19 对 act 外的微任务状态更新报 not wrapped in act，违反「输出 pristine」门槛。
  await act(async () => {
    await user.click(screen.getByRole('button', { name: '登录' }))
  })
}

beforeEach(() => {
  authActions.clear()
  loginMock.mockReset()
})

afterEach(() => {
  cleanup()
  authActions.clear()
})

describe('登录页流程（mock login）', () => {
  it('成功：写入会话（store+sessionStorage）并跳转 /files', async () => {
    loginMock.mockResolvedValue(sessionResponse)
    const user = userEvent.setup()
    const router = await renderLoginPage()
    await fillAndSubmit(user)

    expect(loginMock).toHaveBeenCalledWith('tester@example.com', 'hunter2hunter2')
    await waitFor(() => expect(router.state.location.pathname).toBe('/files'))
    await screen.findByTestId('files-route')
    expect(useAuth.getState().token).toBe(sessionResponse.access_token)
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(sessionResponse.access_token)
    expect(sessionStorage.getItem(EXPIRES_KEY)).toBe(sessionResponse.expires_at)
    expect(JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null')).toEqual(sessionResponse.user)
  })

  it('失败：中文错误经 Alert 可见、会话未写、不跳转', async () => {
    loginMock.mockRejectedValue(new ApiError('邮箱或密码不正确。', 401))
    const user = userEvent.setup()
    const router = await renderLoginPage()
    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('邮箱或密码不正确。')
    expect(router.state.location.pathname).toBe('/login')
    expect(useAuth.getState().token).toBe('')
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(screen.queryByTestId('files-route')).toBeNull()
  })

  it('限流：translateError 等待时长文案原样显示（429）', async () => {
    loginMock.mockRejectedValue(new ApiError(translateError('too many login attempts', 429), 429))
    const user = userEvent.setup()
    const router = await renderLoginPage()
    await fillAndSubmit(user)

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      '登录尝试过于频繁，请稍后重试（最多约 10 分钟）。',
    )
    expect(router.state.location.pathname).toBe('/login')
  })

  it('pending：提交后按钮 disabled，重复点击不再调用 login；完成后正常跳转', async () => {
    let settle!: (value: LoginResponse) => void
    loginMock.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    const user = userEvent.setup()
    const router = await renderLoginPage()
    await fillAndSubmit(user)

    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1))
    const button = screen.getByRole('button', { name: '登录' })
    expect(button).toBeDisabled()
    await user.click(button) // disabled：不触发第二次提交
    expect(loginMock).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/login')

    await act(async () => { settle(sessionResponse) }) // 同样在 act 内 flush resolve→navigate
    await waitFor(() => expect(router.state.location.pathname).toBe('/files'))
    expect(await screen.findByTestId('files-route')).toBeInTheDocument() // 登录页已随跳转卸载
  })

  it('布局静态件：Heading「Agent 云仓」、mascot 图、注册提示「注册暂未开放」', async () => {
    await renderLoginPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Agent 云仓' })).toBeInTheDocument()
    expect(screen.getByAltText('土拨鼠吉祥物')).toHaveAttribute('src', '/images/cloud-gopher-pixel.png')
    expect(screen.getByText('注册暂未开放')).toBeInTheDocument()
  })
})
