// 上传队列面板（Task 8）：右下方悬浮（Dock 居中 bottom-4，本面板右缘 bottom-28，与 main pb-28 同区避让）。
// 容器用 vendored floating-panel（PATH B 有件，manifest 已列）；行用 self-build Attachment（见其头注释 swap 计划）。
// 播报沿用旧版语义：aria-live="polite" + aria-label="上传进度"（FileWorkbench.vue 模板 486 行 section）。
// 隐藏 input 也在此：Dock 上传钮与工具栏「上传文件」统一经 useUploadManager.openPicker 点击它
// （旧 uploadInput?.click() 同款），选择后 value 复位允许重复选同一文件（旧 462 行）。
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation } from 'react-router'
import { folderIdFromLocation } from '@/components/app/TopBar'
import { Attachment } from '@/components/app/Attachment'
import { FloatingPanel } from '@/components/glinui/components/floating-panel'
import { setUploadInput, useUploadManager } from '@/features/files/useUploadManager'

export function UploadQueuePanel() {
  const manager = useUploadManager()
  const { pathname, search } = useLocation()
  const [dismissed, setDismissed] = useState(false)
  const lastCount = useRef(0)

  useEffect(() => {
    // 新任务进入时重新展开被手动关闭的面板（后台队列不因收起而停摆）
    if (manager.tasks.length > lastCount.current) setDismissed(false)
    lastCount.current = manager.tasks.length
  }, [manager.tasks.length])

  const handlePick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) manager.submitFiles(files, folderIdFromLocation(pathname, search))
  }

  return (
    <>
      <input
        ref={(el) => {
          setUploadInput(el)
        }}
        type="file"
        multiple
        hidden
        data-testid="upload-input"
        aria-hidden="true"
        onChange={handlePick}
      />
      {manager.tasks.length === 0 || dismissed ? null : (
        <div className="fixed bottom-28 right-4 z-50 w-80 max-w-[calc(100vw-2rem)]">
          <FloatingPanel
            draggable={false}
            width={320}
            closable
            onClose={() => setDismissed(true)}
            className="relative"
          >
            <section aria-live="polite" aria-label="上传进度" data-testid="upload-queue" className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-[var(--color-foreground)]">上传任务</h2>
              {manager.tasks.map((task) => (
                <Attachment
                  key={task.id}
                  task={task}
                  onCancel={() => manager.cancelTask(task.id)}
                  onRetry={() => manager.retryTask(task.id)}
                />
              ))}
            </section>
          </FloatingPanel>
        </div>
      )}
    </>
  )
}
