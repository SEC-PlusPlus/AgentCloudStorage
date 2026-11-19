// 新建文件夹对话框（Task 9，Dock onNewFolder 消费；brief 组件清单未列此文件——弹窗归并进操作集，
// changelog 记为文件名偏离）。props 与行目标对话框不同形：create 无 target（目标是「当前目录」，
// 由 URL ?folder= 读取，搜索态=根目录 0——与旧版 folderID.value 语义一致）。
// 名称合法性完全交后端（translateError 的「当前目录中已存在同名文件夹。」/「请输入有效的…」直通），
// 前端仅 trim 空值禁用确认（旧 `:disabled="!dialogValue.trim()"`）。Enter 提交=旧 form @submit.prevent。
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import { createFolder } from '@/api/storage'
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

export interface NewFolderDialogProps {
  open: boolean
  onClose(): void
}

export function NewFolderDialog({ open, onClose }: NewFolderDialogProps) {
  const queryClient = useQueryClient()
  const { pathname, search } = useLocation()
  const folderId = folderIdFromLocation(pathname, search)
  const [name, setName] = useState('')

  // 旧 openDialog 每次打开清 dialogValue：取消后重开不留草稿。
  useEffect(() => {
    if (open) setName('')
  }, [open])

  const mutation = useMutation({
    mutationFn: (nextName: string) => createFolder(nextName, folderId),
    onSuccess: () => {
      toast('文件夹已创建。') // 旧 confirmDialog 文案
      applyInvalidations(queryClient, computeInvalidations({ type: 'create-folder', fromFolder: folderId }, folderId))
      setName('')
      onClose()
    },
    onError: (error) => toast.error(mutationErrorMessage(error)),
  })

  const trimmed = name.trim()
  const submit = () => {
    if (!trimmed || mutation.isPending) return
    mutation.mutate(trimmed)
  }

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <ModalContent variant="glass" size="sm">
        <ModalHeader>
          <ModalTitle>创建文件夹</ModalTitle>
          <ModalDescription>在当前目录中新建一个文件夹。</ModalDescription>
        </ModalHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex flex-col gap-2"
        >
          <label className="flex flex-col gap-1.5 text-sm text-[var(--color-foreground)]">
            文件夹名称
            <Input
              aria-label="文件夹名称"
              variant="glass"
              placeholder="例如：旅行照片"
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
