// 拖放全屏遮罩（Task 8）：window 级 dragenter/dragleave **深度计数**防闪烁
// （子元素进出各触发一对 enter/leave，布尔开关会高频闪；计数归零才算真正离开窗口）。
// 「搜索态禁止拖入」不在本组件：keywordMode 时 FilesPage 直接不挂载此组件——
// 强于旧版 onDrop 的 `if (isSearching...) return`（旧版只在放下时静默忽略，无遮罩概念；此处连误导视觉一起省掉）。
// 素材复用 cloud-gopher-pixel.png（asset-credits 已登记；装饰性 alt=""）。
import { useEffect, useRef, useState } from 'react'
import { EMPTY_MASCOT_SRC } from '@/components/app/Empty'

export interface DropOverlayProps {
  onFiles(files: File[]): void
}

function isFileDrag(event: DragEvent): boolean {
  const dt = event.dataTransfer
  if (!dt) return false
  // 真浏览器 dragenter 阶段 files 可能为空，types 含 'Files' 即认定为文件拖入
  if (dt.types?.includes?.('Files')) return true
  return (dt.files?.length ?? 0) > 0
}

export function DropOverlay({ onFiles }: DropOverlayProps) {
  const [visible, setVisible] = useState(false)
  const depth = useRef(0)
  const handlerRef = useRef(onFiles)
  handlerRef.current = onFiles // 回调走 ref：父级查询刷新重渲染不重挂 window 监听

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      depth.current += 1
      setVisible(true)
    }
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setVisible(false)
    }
    const onOver = (event: DragEvent) => {
      event.preventDefault() // drop 触发的前置（旧模板 @dragover.prevent 的等价）
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setVisible(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) handlerRef.current(files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!visible) return null
  return (
    <div
      data-testid="drop-overlay"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/45 backdrop-blur-sm"
    >
      <img
        src={EMPTY_MASCOT_SRC}
        alt=""
        width={96}
        className="h-24 w-auto [image-rendering:pixelated] drop-shadow-[0_1px_2px_rgb(0_0_0/_0.45)]"
      />
      <span className="text-sm text-white/90">松开鼠标，上传到当前目录</span>
    </div>
  )
}
