// 属主分享对话框（Task W1 / spec §1.1）。props 形状对齐 MoveDialog（brief Interfaces 钉死）：
// 分享语义仅单文件行——数组经 normalizeSingleTarget 归一（多选/空数组=null 关闭态），
// 文件夹行防御性忽略（入口已在面板置灰/菜单不渲染双闸，此处第三闸）。
// 密码预检与服务端 share.CreateOptions 同语义（service.go:81：runes≤64 且 UTF-8≤72 字节），
// 前端先行拦截避免 400 才知道；创建失败经 mutationErrorMessage 弹窗内联呈现（W1 裁定：
// 本弹窗错误走内联而非 MoveDialog 式 toast——结果态可就地重试）。
// 复制红线（spec §7）：token 即凭证，仅显式点击「复制链接」才写剪贴板；clipboard 不可用/被拒
// 回退选中文本（input.select），不报错不打断。vendored 无 select 组件（registry 名单外），
// 有效期选择用原生 <select> + 玻璃类对齐 Input 视觉语言（MoveDialog 树选择器同款自建惯例）。
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Share2 } from 'lucide-react'
import { createShare, shareUrl, type ShareItem } from '@/api/shares'
import { Button } from '@/components/glinui/components/button'
import { Input } from '@/components/glinui/components/input'
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/glinui/components/modal'
import { mutationErrorMessage } from './actions'
import { normalizeSingleTarget } from './RenameDialog'
import type { FileRow } from './useFileRows'

export interface ShareDialogProps {
  target: FileRow | FileRow[] | null
  onClose(): void
}

/** 有效期五档：永久=不发 expires_in（后端 nil→永久）；value 即秒数串。 */
const EXPIRY_OPTIONS: readonly { value: string; label: string; seconds?: number }[] = [
  { value: 'permanent', label: '永久' },
  { value: '3600', label: '1 小时', seconds: 3600 },
  { value: '86400', label: '1 天', seconds: 86400 },
  { value: '604800', label: '7 天', seconds: 604800 },
  { value: '2592000', label: '30 天', seconds: 2592000 },
]

const PASSWORD_MAX_RUNES = 64
const PASSWORD_MAX_BYTES = 72

/** 与服务端 ErrPasswordTooLong 同语义的双闸；空密码=不设密码，直接放行。纯函数便于钉测。 */
export function validateSharePassword(password: string): string | null {
  if (!password) return null
  if ([...password].length > PASSWORD_MAX_RUNES) return `访问密码最长 ${PASSWORD_MAX_RUNES} 个字符。`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `访问密码过长（不超过 ${PASSWORD_MAX_RUNES} 个字符、UTF-8 编码 ${PASSWORD_MAX_BYTES} 字节）。`
  }
  return null
}

export function ShareDialog({ target, onClose }: ShareDialogProps) {
  const row = normalizeSingleTarget(target)
  const open = row !== null && row.kind === 'file'
  const [password, setPassword] = useState('')
  const [expiry, setExpiry] = useState('permanent')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [created, setCreated] = useState<ShareItem | null>(null)
  const urlRef = useRef<HTMLInputElement | null>(null)

  // 开/关/换行一律复位（MoveDialog 仅在 row 在场复位；此处结果态必须随关闭清空，防串台）。
  useEffect(() => {
    setPassword('')
    setExpiry('permanent')
    setFieldError(null)
    setCreated(null)
  }, [row])

  const mutation = useMutation({
    // vars 入参非闭包捕获（MoveDialog/RenameDialog 同款纪律）。
    mutationFn: (vars: { fileId: number; password: string; expiresIn?: number }) =>
      createShare(vars.fileId, {
        ...(vars.password ? { password: vars.password } : {}),
        ...(vars.expiresIn !== undefined ? { expires_in: vars.expiresIn } : {}),
      }),
    onSuccess: (item) => setCreated(item),
    onError: (error) => setFieldError(mutationErrorMessage(error)),
  })

  const submit = () => {
    if (!open || !row || row.kind !== 'file' || mutation.isPending) return
    const invalid = validateSharePassword(password)
    if (invalid) {
      setFieldError(invalid) // 预检失败：红字即停，不发请求
      return
    }
    setFieldError(null)
    const seconds = EXPIRY_OPTIONS.find((option) => option.value === expiry)?.seconds
    void mutation.mutate({ fileId: row.id, password, expiresIn: seconds })
  }

  const copyLink = async () => {
    if (!created) return
    const url = shareUrl(created.token)
    try {
      await navigator.clipboard.writeText(url)
      toast('链接已复制到剪贴板。')
    } catch {
      // clipboard 缺失/权限拒绝：回退选中文本，用户 Ctrl+C 自行复制（不弹错误免噪音）。
      urlRef.current?.select()
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <ModalContent variant="glass" size="sm">
        <ModalHeader>
          <ModalTitle>{created ? '链接已生成' : '分享文件'}</ModalTitle>
          {/* ModalDescription 常驻（Radix 缺失 console.warn 门槛，RenameDialog 同注） */}
          <ModalDescription>
            {created
              ? '任何拿到链接的人都可以通过网页访问该文件，可随时在「我的分享」中撤销。'
              : `为「${row && row.kind === 'file' ? row.name : ''}」生成公开分享链接。`}
          </ModalDescription>
        </ModalHeader>

        {created ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm text-[var(--color-foreground)]">
              分享链接
              <Input
                ref={urlRef}
                aria-label="分享链接"
                variant="glass"
                readOnly
                value={shareUrl(created.token)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            {created.has_password ? <p className="text-xs opacity-70">该链接需要访问密码。</p> : null}
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                关闭
              </Button>
              <Button type="button" variant="liquid" onClick={() => void copyLink()}>
                <Copy size={14} /> 复制链接
              </Button>
            </ModalFooter>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
            className="flex flex-col gap-2"
          >
            <label className="flex flex-col gap-1.5 text-sm text-[var(--color-foreground)]">
              访问密码（可选）
              <Input
                aria-label="访问密码（可选）"
                type="password"
                variant="glass"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setFieldError(null) // 草稿修订即清红字（预检/服务端错误同口径）
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-[var(--color-foreground)]">
              有效期
              <select
                aria-label="有效期"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                className="h-9 w-full rounded-md border border-white/15 bg-[var(--glass-1-surface)] px-2 text-sm text-[var(--color-foreground)] backdrop-blur-md focus:border-[var(--color-accent)] dark:border-white/10"
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {fieldError ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {fieldError}
              </p>
            ) : null}
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" variant="liquid" disabled={mutation.isPending}>
                <Share2 size={14} /> 创建分享
              </Button>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  )
}
