// 选择浮动操作条（Task 9；Task 2-B abc-4 收窄；终评修波 abc-6 兜底）：批量载体 + <lg 单选兜底。
// 渲染条件裁定（两条之一）：(a) selection.length≥2（任意视口宽，今日语义不变）；
// (b) selection.length===1 且视口 <lg——DetailPanel aside 是 `hidden lg:block`，窄屏下单选若无本条
// 则整体零动作面（branch 前回退，abc-6 修复点）。lg+ 单选仍恒缺席（abc-4 面板唯一载体不削弱）。
// <lg 且单选时浮条与面板钮的「双写」仅 CSS 层：面板此时 hidden，实际可交互动作面唯一。
// 窄屏判定用 window.innerWidth + resize 订阅而非 CSS lg:hidden 或 matchMedia：jsdom 不跑媒体查询、
// matchMedia polyfill 恒 matches:false（test-setup.ts），只有 innerWidth 通路能让既有 abc-4 缺席钉
// （缺省 1024=lg 激活）与 <lg 兜底钉（钉 800）同时诚实成立。
// 位置仍在 Dock 之上（Dock 固定 bottom-4 z-40，本条 bottom-24 同层级居中，pointer-events 分内外层=Dock 同款技术）。
// 批量语义沿用 Task 9 裁定：下载仅作用于所选中文件行（混选中只下载文件部分）；移入回收站可多选
// （文件夹=删除空目录语义，非空报错文案由服务端 translateError 呈现）。
// 移动/重命名/问 AI（单目标语义）已从本条整体移除——多选下恒禁用=死钮（abc-4：条只留批量，
// 单目标动作唯一入口=DetailPanel/右键菜单），disabled 占位不保留；(b) 分支下这三钮走面板/右键菜单的
// 既有事实不变（<lg 无面板，单目标动作入口=右键菜单，浮条只兜批量两件，语义与多选一致）。
import { useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/glinui/components/button'
import type { FileRow } from './useFileRows'

/** Tailwind `lg` 断点=min-width:1024px（abc-6 判定单源，测试注释同口径）。 */
const LG_BREAKPOINT_PX = 1024

/** 视口是否 <lg：初值渲染期读 innerWidth，resize 事件订阅回写（浏览器真实窗口变化即触发）。 */
function useBelowLg(): boolean {
  const [belowLg, setBelowLg] = useState(() => window.innerWidth < LG_BREAKPOINT_PX)
  useEffect(() => {
    const onResize = () => setBelowLg(window.innerWidth < LG_BREAKPOINT_PX)
    onResize() // 挂载后复核一次，覆盖 render→effect 间隙的宽度变化
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return belowLg
}

export interface RowToolbarProps {
  selection: FileRow[]
  onDownload(): void
  onTrash(): void
}

export function RowToolbar({ selection, onDownload, onTrash }: RowToolbarProps) {
  const belowLg = useBelowLg() // 恒先于早退调用（hook 规则）
  if (selection.length === 0) return null
  if (selection.length === 1 && !belowLg) return null // (a)/(b) 联合闸
  const hasFile = selection.some((row) => row.kind === 'file')

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center" data-testid="row-toolbar">
      <div
        role="toolbar"
        aria-label="所选项目操作"
        className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-2 shadow-lg backdrop-blur-xl"
      >
        <span className="px-2 text-xs tabular-nums text-[var(--color-foreground)] opacity-80" data-testid="toolbar-count">
          已选 {selection.length} 项
        </span>
        <Button
          size="sm"
          variant="glass"
          disabled={!hasFile}
          title={hasFile ? undefined : '文件夹不可下载'}
          onClick={onDownload}
        >
          <Download size={14} />
          下载
        </Button>
        <Button size="sm" variant="glass" className="text-red-600 dark:text-red-400" onClick={onTrash}>
          <Trash2 size={14} />
          移入回收站
        </Button>
      </div>
    </div>
  )
}
