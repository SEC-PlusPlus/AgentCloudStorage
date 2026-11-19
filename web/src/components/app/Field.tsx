// SELF-BUILD（spec §11 / manifest「registry-swap-pending」）：glinui `field` 仅存在于注册表，
// PATH B 编译包无此项，故此处自建最小可访问字段：
// label(htmlFor↔id) + 控件 render-prop（自动接线 aria-describedby/aria-invalid）+ 描述/错误槽。
// 保持薄且泛型：字段值/校验由调用方掌控，本件只负责 a11y 布线与槽位呈现。
// TODO(Task 13 swap): registry 恢复可达后换回 @glinui field 源码并删除本件。
import type { ReactNode } from 'react'
import { Label } from '@/components/glinui/components/label'

export interface FieldControlProps {
  id: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export interface FieldProps {
  /** 控件 id；描述/错误槽 id 由此派生（`${id}-description` / `${id}-error`）。 */
  id: string
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  /** 控件渲染函数：接收 Field 的接线属性（id/aria-*），其余属性由调用方给。 */
  children: (controlProps: FieldControlProps) => ReactNode
}

export function Field({ id, label, description, error, children }: FieldProps) {
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {description ? (
        <p id={`${id}-description`} className="text-xs text-[var(--color-foreground)] opacity-70">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
