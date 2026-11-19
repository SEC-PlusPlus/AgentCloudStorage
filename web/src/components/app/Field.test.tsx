// Field（SELF-BUILD，manifest §registry-swap-pending）可访问性契约：
// ①label 经 htmlFor/id 与控件关联（getByLabelText 可达）；②error 槽：role=alert 文本 +
// aria-invalid=true + aria-describedby 指向错误槽；③description 并入 aria-describedby（描述在前）；
// ④无 error 时不带 aria-invalid/aria-describedby 残留。
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field } from '@/components/app/Field'
import { Input } from '@/components/glinui/components/input'

function renderField(props?: { description?: string; error?: string }) {
  return render(
    <Field id="login-email" label="邮箱" {...props}>
      {(control) => <Input {...control} type="email" />}
    </Field>,
  )
}

afterEach(cleanup)

describe('Field（自建薄件）a11y 接线', () => {
  it('label 经 htmlFor/id 关联到控件', () => {
    renderField()
    const input = screen.getByLabelText('邮箱')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('id', 'login-email')
    expect(input).toHaveAttribute('type', 'email') // 控件本体由调用方决定，Field 只接 id/aria
  })

  it('error 槽：文本可见 + aria-invalid + aria-describedby 指向错误槽', () => {
    renderField({ error: '邮箱格式不正确' })
    expect(screen.getByRole('alert')).toHaveTextContent('邮箱格式不正确')
    const input = screen.getByLabelText('邮箱')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'login-email-error')
  })

  it('description 槽并入 aria-describedby', () => {
    renderField({ description: '用于登录的邮箱' })
    expect(screen.getByText('用于登录的邮箱')).toHaveAttribute('id', 'login-email-description')
    expect(screen.getByLabelText('邮箱')).toHaveAttribute('aria-describedby', 'login-email-description')
  })

  it('描述与错误并存时 aria-describedby 按「描述 错误」顺序拼接', () => {
    renderField({ description: '用于登录的邮箱', error: '邮箱格式不正确' })
    expect(screen.getByLabelText('邮箱')).toHaveAttribute(
      'aria-describedby',
      'login-email-description login-email-error',
    )
  })

  it('无 description/error 时不残留 aria-describedby/aria-invalid', () => {
    renderField()
    const input = screen.getByLabelText('邮箱')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).not.toHaveAttribute('aria-invalid')
  })
})
