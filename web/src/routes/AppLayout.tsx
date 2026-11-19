// 应用外壳（Task 4 骨架 + Task 6 实装 + Task 8 上传接线）：固定背景层 + TopBar（品牌/面包屑/用量）+ Outlet + 底部 Dock。
// R-T4-a2 背景占位 swap 已兑现：CSS 占位类删除，改用 vendored AuroraBackground + DotPattern（同 LoginRoute 用法）。
// 401 接线效应原样保留（Review Focus #1）：挂载注册、卸载反注册。
// Task 8：Dock onUpload 注入真实实现（openPicker→隐藏 input→队列 submit）；上传队列面板挂外壳层，
// 跨 /files、/trash 持续可见（旧版进度区块只存在于工作台页）。
// Task 9：Dock onNewFolder 实装=新建目录 modal（弹窗挂外壳层：Dock 全路由可见，
// 落点目录=folderIdFromLocation——/trash 或搜索态=根目录，与旧版 folderID 语义一致）。
// T13b 修复轮 1（评审裁定）：onSearch 由 noop 转最小接线=聚焦 TopBar 搜索输入框（Task 7 裁定入口
// 本就是 ?q= 驱动的顶栏输入框）；command/cmdk 面板 UI 仍顺延 registry 换源窗口（验收清单 C2.6）。
import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { setUnauthorizedHandler } from '@/api/client'
import { AuroraBackground } from '@/components/glinui/components/aurora-background'
import { DotPattern } from '@/components/glinui/components/dot-pattern'
import { Dock, noopDockActions } from '@/components/app/Dock'
import { TopBar } from '@/components/app/TopBar'
import { UploadQueuePanel } from '@/components/app/UploadQueuePanel'
import { NewFolderDialog } from '@/features/files/NewFolderDialog'
import { useUploadManager } from '@/features/files/useUploadManager'
import { authActions } from '@/stores/auth'

export function AppLayout() {
  const navigate = useNavigate()
  const uploadManager = useUploadManager()
  const [newFolderOpen, setNewFolderOpen] = useState(false)

  useEffect(() => {
    // 401 接线：request/fileContentResponse 的 401 分支 → 清会话 → toast → 跳 /login。
    // T13 carry #6（Task 4 minor ②）：卸载改「恢复前值」而非置 null——当前前值恒 null（唯一注册方），
    // 语义与原 cleanup 等价，仅防御多注册方并存时的互相踩掉；登录页等外壳外组件不再残留旧 navigate 的保证不变。
    const previous = setUnauthorizedHandler(() => {
      authActions.clear()
      toast('登录已过期')
      navigate('/login')
    })
    return () => {
      setUnauthorizedHandler(previous)
    }
  }, [navigate])

  return (
    <div className="relative flex min-h-full flex-col">
      {/* 背景固定一层（规范：内容滚动其上，玻璃分层 §10） */}
      <div aria-hidden className="fixed inset-0 -z-10">
        <AuroraBackground
          colors={['var(--color-accent)', 'var(--color-accent-foreground)', 'var(--color-surface)']}
          intensity={0.5}
        />
        <DotPattern dotColor="var(--glass-border)" dotOpacity={0.35} className="opacity-50" />
      </div>

      <TopBar />

      {/* pb 预留底部 dock 悬浮高度，避免表格末行被 dock 遮挡（spec §5.2 浮条/ dock 同区）。
          Task 1-A：p-6→p-4 收紧外缘留白；列表已改容器内滚，pb-28 带不再叠加页面留白感知。 */}
      <main className="flex-1 p-4 pb-28">
        <Outlet />
      </main>

      <Dock
        actions={{
          ...noopDockActions,
          onUpload: uploadManager.openPicker,
          onNewFolder: () => setNewFolderOpen(true),
          onSearch: () => {
            // 聚焦顶栏搜索框（TopBar form[role=search] 内 input，placeholder「搜索文件…」）；
            // 键入+Enter 走既有 ?q= 提交流，本接线只搬光标不发明新状态。
            document.querySelector<HTMLInputElement>('[role="search"] input')?.focus()
          },
        }}
      />
      <UploadQueuePanel />
      <NewFolderDialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} />
    </div>
  )
}
