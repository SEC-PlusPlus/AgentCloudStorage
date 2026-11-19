// 重命名对话框（Task 9）。props 形状=brief Interfaces 钉死的 `{ target: FileRow | FileRow[] | null; onClose(): void }`
// ——重命名语义仅单选：数组传多视为无效目标（关闭态），单元素数组取该项。
// 规则全部交后端：前端不预判重名/字符集，仅 trim 空值禁用确认（旧版 `:disabled="!dialogValue.trim()"` 同语义）；
// 服务端中文限制文案经 translateError → mutationErrorMessage → toast 呈现（评审裁定：对话框错误走 toast 透传，
// 弹窗保持打开可改可重试；旧版为弹窗内 errorMessage，载体换、文案不变）。
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import { renameFile, renameFolder } from '@/api/storage'
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
import { folderIdFromLocation } from '@/components/app/TopBar'
import { applyInvalidations, computeInvalidations, mutationErrorMessage } from './actions'
import type { FileRow } from './useFileRows'

export interface RenameDialogProps {
  target: FileRow | FileRow[] | null
  onClose(): void
  /** T13 carry #14：行真实源目录（搜索态 URL 无 folder 语境，调用方传 item.folder_id 作失效 from 键）；省略=当前目录。 */
  fromFolder?: number
}

/** 数组→单选归一（多选无重命名语义 → null 关闭态）。 */
export function normalizeSingleTarget(target: FileRow | FileRow[] | null): FileRow | null {
  return Array.isArray(target) ? (target.length === 1 ? (target[0] ?? null) : null) : target
}

export function RenameDialog({ target, onClose, fromFolder }: RenameDialogProps) {
  const row = normalizeSingleTarget(target)
  const queryClient = useQueryClient()
  const { pathname, search } = useLocation()
  const folderId = folderIdFromLocation(pathname, search)
  const [name, setName] = useState('')

  // 打开（或切换目标行）时预填当前名（旧 openDialog：dialogValue = entry 名）。
  useEffect(() => {
    if (row) setName(row.name)
  }, [row])

  const mutation = useMutation({
    // row 随变量入参（非闭包捕获）：mutationFn 定义期 row 可为 null，无空断言。
    mutationFn: (vars: { row: FileRow; name: string }) =>
      vars.row.kind === 'file' ? renameFile(vars.row.id, vars.name) : renameFolder(vars.row.id, vars.name),
    onSuccess: () => {
      toast('名称已更新。') // 旧 confirmDialog 文案
      // T13 carry #14：源键优先用调用方注入的行真实目录（搜索态），缺省回落当前目录（browse 态旧行为）。
      applyInvalidations(
        queryClient,
        computeInvalidations({ type: 'rename', fromFolder: fromFolder ?? folderId }, folderId),
      )
      onClose()
    },
    onError: (error) => toast.error(mutationErrorMessage(error)),
  })

  const trimmed = name.trim()
  const submit = () => {
    if (!row || !trimmed || mutation.isPending) return
    mutation.mutate({ row, name: trimmed })
  }

  return (
    <Modal open={row !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <ModalContent variant="glass" size="sm">
        <ModalHeader>
          <ModalTitle>重命名</ModalTitle>
          {/* ModalDescription 常驻：Radix Dialog 缺失会 console.warn（pristine 门槛） */}
          <ModalDescription>为「{row?.name ?? ''}」输入新名称。</ModalDescription>
        </ModalHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit() // Enter 提交（旧 form @submit.prevent 语义）
          }}
          className="flex flex-col gap-2"
        >
          <label className="flex flex-col gap-1.5 text-sm text-[var(--color-foreground)]">
            新名称
            <Input
              aria-label="新名称"
              variant="glass"
              maxLength={255}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="liquid" disabled={!trimmed || mutation.isPending}>
              确认
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
