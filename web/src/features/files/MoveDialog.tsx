// 移动到对话框（Task 9）。props 形状=brief Interfaces 钉死；移动语义仅单选（旧版无多选，
// 控制端裁定保持单选 + 浮条显计数），数组传多视为无效目标。
// 目标选择器实现偏离说明（changelog 记录）：brief 指 vendored `tree`——PATH B 编译版 Tree 的
// TreeNode 只有 label/children/href，文件夹节点点击=组件内部展开态，**不暴露 onSelect 与展开回调**，
// 无法接「选中目标目录 + 按 ['folders',parentId] 惰性取子级」两项需求；且禁止魔改 vendor 文件。
// 故此处按 spec §11 薄 wrapper 路线自建选择器：视觉沿 vendored tree 的玻璃边框/行距/缩进语言，
// 数据仍走 ['folders', parentId] 键契约（Task 7 BFS 暖缓存天然命中当前目录与祖先链）。
// 自嵌移动不预判（旧版 UI 递归排除子孙的做法放弃——控制端裁定交后端：409 invalid folder move
// → translateError「不能将文件夹移动到自身或其子目录中。」经 toast 透传）；
// 选择当前所在父目录=允许提交，冲突与否由服务端说话。
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocation } from 'react-router'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { listFolders, moveFile, moveFolder } from '@/api/storage'
import { Button } from '@/components/glinui/components/button'
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/glinui/components/modal'
import { folderIdFromLocation } from '@/components/app/TopBar'
import { ROOT_LABEL } from '@/features/files/crumbs'
import { applyInvalidations, computeInvalidations, mutationErrorMessage } from './actions'
import { normalizeSingleTarget } from './RenameDialog'
import type { FileRow } from './useFileRows'

export interface MoveDialogProps {
  target: FileRow | FileRow[] | null
  onClose(): void
  /** T13 carry #14：被移项真实源目录（搜索态 URL 无 folder 语境，调用方传 item.folder_id 作失效 from 键）；省略=当前目录。 */
  fromFolder?: number
}

export function MoveDialog({ target, onClose, fromFolder }: MoveDialogProps) {
  const row = normalizeSingleTarget(target)
  const queryClient = useQueryClient()
  const { pathname, search } = useLocation()
  const folderId = folderIdFromLocation(pathname, search)
  const [selectedId, setSelectedId] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set([0]))

  // 每次打开复位：默认选中根（旧 openDialog targetID=0），根展开一层可见。
  useEffect(() => {
    if (row) {
      setSelectedId(0)
      setExpanded(new Set([0]))
    }
  }, [row])

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const mutation = useMutation({
    // row/to 随变量入参（非闭包捕获 null 期状态），无空断言。
    mutationFn: (vars: { row: FileRow; to: number }) =>
      vars.row.kind === 'file' ? moveFile(vars.row.id, vars.to) : moveFolder(vars.row.id, vars.to),
    onSuccess: () => {
      toast('项目已移动。') // 旧 confirmDialog 文案
      applyInvalidations(
        queryClient,
        // T13 carry #14：源键优先用调用方注入的行真实目录（搜索态），缺省回落当前目录（browse 态旧行为）。
        computeInvalidations(
          { type: 'move', fromFolder: fromFolder ?? folderId, toFolder: selectedId },
          folderId,
        ),
      )
      onClose()
    },
    onError: (error) => toast.error(mutationErrorMessage(error)),
  })

  return (
    <Modal open={row !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <ModalContent variant="glass" size="md">
        <ModalHeader>
          <ModalTitle>移动到</ModalTitle>
          <ModalDescription>把「{row?.name ?? ''}」移动到所选目录。</ModalDescription>
        </ModalHeader>
        <FolderPicker selectedId={selectedId} onSelect={setSelectedId} expanded={expanded} onToggle={toggleExpand} />
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant="liquid"
            disabled={mutation.isPending}
            onClick={() => {
              if (!row || mutation.isPending) return
              void mutation.mutate({ row, to: selectedId })
            }}
          >
            确认
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

/**
 * 层级缩进=静态类表（深度上限 MAX_DEPTH 对应旧 refreshTargets 的 depth>20 护栏——个人量级 16 层
 * 足够，超限按表尾显示，旧版直接停止收集同理防御无限深）。
 * 不用内联 paddingLeft（开发规范：禁内联 style 除非动效计算值；vendored tree.js 的 16px 步进语言保留）。
 */
const MAX_DEPTH = 15
const INDENT_CLASS = [
  'pl-1', 'pl-[17px]', 'pl-[33px]', 'pl-[49px]', 'pl-[65px]', 'pl-[81px]', 'pl-[97px]', 'pl-[113px]',
  'pl-[129px]', 'pl-[145px]', 'pl-[161px]', 'pl-[177px]', 'pl-[193px]', 'pl-[209px]', 'pl-[225px]', 'pl-[241px]',
]

interface PickerProps {
  selectedId: number
  onSelect(id: number): void
  expanded: ReadonlySet<number>
  onToggle(id: number): void
}

/** 根节点 + 递归子级。惰性：仅展开过（expanded 含）的目录发 ['folders',id] 查询。
 * T13 carry #13（Task 9 minor ⑩）键盘模式备案：本件是 tree/treeitem 角色 + 逐节点原生
 * <button> 的混合模式——Tab 逐钮聚焦可用，但未实现规范 roving-tabindex 树模式（单 tabindex 位 +
 * ↑↓/←→/Home/End 移动、展开收起随方向键）；完整化留给 Task 13 registry swap（vendored <tree>）
 * 或后续键盘轮，届时一并处理。选中态单一事实源=treeitem aria-selected（T13 已去重按钮上的
 * aria-pressed——双属性会让读屏对同一状态双报）。 */
function FolderPicker({ selectedId, onSelect, expanded, onToggle }: PickerProps) {
  return (
    <div
      role="tree"
      aria-label="目标文件夹"
      className="max-h-64 overflow-y-auto rounded-lg border py-1 backdrop-blur-md border-white/10 bg-[var(--glass-1-surface)]"
    >
      <FolderBranch
        id={0}
        name={ROOT_LABEL}
        depth={0}
        selectedId={selectedId}
        onSelect={onSelect}
        expanded={expanded}
        onToggle={onToggle}
      />
    </div>
  )
}

function FolderBranch({ id, name, depth, selectedId, onSelect, expanded, onToggle }: PickerProps & {
  id: number
  name: string
  depth: number
}) {
  const isOpen = expanded.has(id)
  const childrenQuery = useQuery({
    queryKey: ['folders', id],
    queryFn: () => listFolders(id),
    enabled: isOpen, // 惰性：收起时不发（与 useFileRows/crumbs BFS 同键，热缓存零请求）
  })
  const children = childrenQuery.data?.items ?? []
  const childrenKnownEmpty = isOpen && !childrenQuery.isPending && children.length === 0
  const indent = INDENT_CLASS[Math.min(depth, MAX_DEPTH)] as string

  return (
    <div role="treeitem" aria-expanded={childrenKnownEmpty ? undefined : isOpen} aria-selected={selectedId === id}>
      <div className={`flex items-center gap-1 pr-2 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] ${indent}`}>
        {childrenKnownEmpty ? (
          <span aria-hidden className="w-6 shrink-0" />
        ) : (
          <button
            type="button"
            aria-label={`${isOpen ? '收起' : '展开'} ${name}`}
            onClick={() => onToggle(id)}
            className="flex w-6 shrink-0 items-center justify-center rounded text-[var(--color-foreground)]/60 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <ChevronRight size={14} className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
          </button>
        )}
        <button
          type="button"
          aria-label={`移动到“${name}”`}
          // T13 carry #13：aria-pressed 已去重——选中态由外层 treeitem aria-selected 单源承载。
          onClick={() => onSelect(id)}
          className={
            selectedId === id
              ? 'flex min-w-0 flex-1 items-center gap-2 rounded-md bg-black/[0.06] px-2 py-1.5 text-left ring-1 ring-[var(--color-accent)] dark:bg-white/[0.08]'
              : 'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left'
          }
        >
          {isOpen ? <FolderOpen size={15} className="shrink-0 opacity-70" /> : <Folder size={15} className="shrink-0 opacity-70" />}
          <span className="truncate text-sm text-[var(--color-foreground)]">{name}</span>
        </button>
      </div>
      {isOpen ? (
        <div role="group">
          {childrenQuery.isPending ? (
            <p className={`py-1.5 text-xs opacity-60 ${indent}`}>载入目录…</p>
          ) : null}
          {children.map((child) => (
            <FolderBranch
              key={child.id}
              id={child.id}
              name={child.name}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
