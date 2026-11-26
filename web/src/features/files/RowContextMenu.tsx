// self-build on @radix-ui/react-context-menu — TODO(Task 13 swap to glinui registry context-menu)
// 行右键菜单（Task 9）。context-menu 在 vendor manifest「registry-only SELF-BUILT」名单内（glinui dist 无件），
// 控制端裁定走 spec §11：Radix 无样式行为原语（glinui 本体即 Radix 封装，非引入第三方 UI 库），
// 外观类逐字对齐 vendored dropdown-menu 的 glass 变体（PATH B 禁改 vendor 件，故类名内联复制并注明来源）。
// 打开机制：FilesTable 的行右键缝已 preventDefault——原生事件不会到达本组件的隐藏 Trigger；
// 因此在 pos 状态变化时向 Trigger span dispatch 合成 contextmenu（携带缝坐标），
// 借 Radix 自家开菜单路径记录 hasInteracted + setPoint(virtual anchor)——
// 既避免「受控 open prop」触发的 dev 警告与左上角错位锚定，也让真实浏览器里锚点精确落在鼠标处。
// 键盘可达由 Radix 提供（方向键在 role=menu/menuitem 间移动，Enter 选择，Esc 关闭）。
import { useEffect, useRef } from 'react'
import {
  Content,
  Item,
  Label,
  Portal,
  Root,
  Separator,
  Trigger,
} from '@radix-ui/react-context-menu'
import { Download, Eye, FolderInput, Pencil, Share2, Sparkles, Trash2 } from 'lucide-react'
import { canAsk } from '@/features/qa/qa-state'
import type { FileRow } from './useFileRows'

export interface RowContextMenuProps {
  row: FileRow | null
  pos: { x: number; y: number } | null
  onClose(): void
  /** 预览（Task 10 已接线：FilesPage openPreview——双击/右键/键盘三路同源汇入 PreviewSheet）。 */
  onPreview(row: FileRow): void
  onDownload(row: FileRow): void
  onRename(row: FileRow): void
  onMove(row: FileRow): void
  /** W1 属主分享——仅文件行出现（文件夹/回收站无入口；builder-check：浮条不放，此处+面板双载体）。 */
  onShare(row: FileRow): void
  onTrash(row: FileRow): void
  /** 问 AI——Task 12 接线：项仅 canAsk.ok 可用（Radix 菜单项 disabled 即不可 select，无需 tooltip）。 */
  onAsk(row: FileRow): void
}

// 逐字来源：vendored dropdown-menu.js 的 content/item variants（base + glass 变体 + size md），
// 合并为静态类串（本组件无 cva 必要）。
const MENU_CONTENT_CLASS =
  'z-50 min-w-44 rounded-md border p-1 text-[var(--color-foreground)] ' +
  'backdrop-blur-xl backdrop-saturate-[180%] bg-[var(--glass-3-surface)] border-white/20 ' +
  '[border-top-color:var(--glass-refraction-top)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-sm)] ' +
  'dark:border-white/[0.1] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.05)_inset,0_8px_24px_rgb(0_0_0_/_0.35)]'
const MENU_ITEM_CLASS =
  'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none text-sm ' +
  'transition-colors focus:bg-black/5 focus:text-[var(--color-foreground)] dark:focus:bg-black/50 ' +
  'data-[highlighted]:bg-black/5 data-[highlighted]:text-[var(--color-foreground)] dark:data-[highlighted]:bg-black/50 ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50'
const MENU_SEPARATOR_CLASS = 'my-1 h-px bg-[var(--color-border)]'
const MENU_LABEL_CLASS = 'px-2 py-1.5 text-sm font-semibold max-w-56 truncate'

export function RowContextMenu({
  row,
  pos,
  onClose,
  onPreview,
  onDownload,
  onRename,
  onMove,
  onShare,
  onTrash,
  onAsk,
}: RowContextMenuProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!row || !pos) return
    const el = triggerRef.current
    if (!el) return
    // 不传 view：jsdom 对 MouseEventInit.view 校验 Window 实例（vitest 代理全局下恒抛），
    // 浏览器/ jsdom 下 clientX/Y 无 view 同样可读，Radix 只用坐标。
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: pos.x,
        clientY: pos.y,
      }),
    )
  }, [row, pos])

  return (
    <Root onOpenChange={(open) => { if (!open) onClose() }} modal>
      {/* 隐藏锚点 Trigger：零尺寸，仅作合成 contextmenu 的派发目标与 virtual-point 载体 */}
      <Trigger
        ref={triggerRef}
        aria-hidden="true"
        tabIndex={-1}
        className="fixed left-0 top-0 size-0 overflow-hidden"
      />
      {row ? (
        <Portal>
          <Content aria-label={`“${row.name}”操作菜单`} className={MENU_CONTENT_CLASS}>
            <Label className={MENU_LABEL_CLASS}>{row.name}</Label>
            <Separator className={MENU_SEPARATOR_CLASS} />
            {row.kind === 'file' ? (
              <>
                <Item className={MENU_ITEM_CLASS} onSelect={() => onPreview(row)}>
                  <Eye size={14} /> 预览
                </Item>
                <Item className={MENU_ITEM_CLASS} onSelect={() => onDownload(row)}>
                  <Download size={14} /> 下载
                </Item>
                <Item className={MENU_ITEM_CLASS} onSelect={() => onShare(row)}>
                  <Share2 size={14} /> 分享
                </Item>
                <Separator className={MENU_SEPARATOR_CLASS} />
              </>
            ) : null}
            <Item className={MENU_ITEM_CLASS} onSelect={() => onRename(row)}>
              <Pencil size={14} /> 重命名
            </Item>
            <Item className={MENU_ITEM_CLASS} onSelect={() => onMove(row)}>
              <FolderInput size={14} /> 移动到…
            </Item>
            {row.kind === 'file' ? (
              // Task 12：不合格文件维持禁用位（菜单项不可 focus 选中，reason 由浮条/预览头部 tooltip 承担）
              <Item className={MENU_ITEM_CLASS} disabled={!canAsk(row).ok} onSelect={() => onAsk(row)}>
                <Sparkles size={14} /> 问 AI
              </Item>
            ) : null}
            <Separator className={MENU_SEPARATOR_CLASS} />
            <Item
              className={`${MENU_ITEM_CLASS} text-red-600 dark:text-red-400`}
              onSelect={() => onTrash(row)}
            >
              <Trash2 size={14} /> {row.kind === 'file' ? '移入回收站' : '删除文件夹'}
            </Item>
          </Content>
        </Portal>
      ) : null}
    </Root>
  )
}
