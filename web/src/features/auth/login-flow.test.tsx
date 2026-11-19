// 登录流程（Task 5 / brief Step 1，mock `login` 于 api 模块层）：
// ①成功：authActions.setSession(login 响应字段) + navigate('/files')（sessionStorage/store/路由三重证据）；
// ②失败：ApiError.message 中文文案双载体可见——内联 Alert(role=alert) + toast.error，会话未写、不跳转；
// ③限流：translateError 命中「too many login attempts」的等待时长文案原样显示（同样 alert+toast 双显）；
// ④pending：请求未决时按钮 disabled，二次点击不重复提交；成功路径无 error toast。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { toast } from 'sonner'
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

// spec §5.1 双载体（alert + toast）证据分列：内联 Alert 用 role=alert（toast 非 alert role，不冲突），
// toast 用 sonner 的 [data-sonner-toast][data-type=error]（toast.error 落地标记）单独定位，
// 两者文本一致性即「双显」。
function expectErrorToastWith(text: string) {
  return waitFor(() =>
    expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toHaveTextContent(text),
  )
}

beforeEach(() => {
  authActions.clear()
  loginMock.mockReset()
})

afterEach(() => {
  // sonner 的 toast store 是模块级单例，跨用例可能残留；dismiss() 无参清空，避免成功用例的 null toast 断言被上个错误用例污染。
  toast.dismiss()
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
    // 成功分支不加 toast（spec §5.1 仅错误走 alert+toast）：
    expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toBeNull()
  })

  it('失败：中文错误经 Alert 可见、会话未写、不跳转', async () => {
    loginMock.mockRejectedValue(new ApiError('邮箱或密码不正确。', 401))
    const user = userEvent.setup()
    const router = await renderLoginPage()
    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('邮箱或密码不正确。')
    await expectErrorToastWith('邮箱或密码不正确。') // 双载体：同一文案也弹 toast.error
    expect(router.state.location.pathname).toBe('/login')
    expect(useAuth.getState().token).toBe('')
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(screen.queryByTestId('files-route')).toBeNull()
  })

  // 终评修波 1：旧 adbcfba AuthPage:19 `login(form.email.trim(), …)` 对齐——粘贴带首尾空格的
  // 邮箱必须 trim 后送达 login 缝（行为钉在缝上；后端「邮箱格式不正确」类误触发的根因即未 trim）。
  // jsdom 偏差双闸（均已在断言外处理，组件逻辑零旁路）：
  // ① set 偏差：规范 email 的 value sanitization 仅去换行，首尾空格合法保留（浏览器原样入 value），
  //   jsdom 在 set 时直接剪掉空格 → 常规赋值路径空格根本进不了受控 state。覆写 value getter
  //   模拟规范浏览器值 ' sec@sec.xyz  '（React onChange 读 event.target.value，即真值通路）。
  // ② submit 偏差：jsdom email validity 把带空格值判 invalid 拦截 submit（浏览器按规范先行裁剪
  //   空白再验、放行提交）→ 用原生 dispatchEvent('submit') 复现浏览器「validity 通过→提交」结果。
  it('trim：粘贴「 sec@sec.xyz  」→ login 收到修剪后的邮箱字符串', async () => {
    loginMock.mockResolvedValue(sessionResponse)
    await renderLoginPage()
    // 理由：findByLabelText 静态型为 HTMLElement，需 .form 引用与 value 描述符覆写（HTMLInputElement 面）。
    const emailInput = (await screen.findByLabelText('邮箱')) as HTMLInputElement
    Object.defineProperty(emailInput, 'value', {
      configurable: true,
      get: () => ' sec@sec.xyz  ',
      set: () => {},
    })
    fireEvent.change(emailInput)
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'hunter2hunter2' } })
    await act(async () => {
      emailInput.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(loginMock).toHaveBeenCalledWith('sec@sec.xyz', 'hunter2hunter2')
  })

  it('限流：translateError 等待时长文案原样显示（429）', async () => {
    loginMock.mockRejectedValue(new ApiError(translateError('too many login attempts', 429), 429))
    const user = userEvent.setup()
    const router = await renderLoginPage()
    await fillAndSubmit(user)

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      '登录尝试过于频繁，请稍后重试（最多约 10 分钟）。',
    )
    await expectErrorToastWith('登录尝试过于频繁，请稍后重试（最多约 10 分钟）。') // 双载体 toast
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
