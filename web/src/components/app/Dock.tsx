// 底部 dock（spec §5.2 用户决定：macOS 风 glass-dock，放弃侧栏）。
// 条目分组：全部文件/回收站/搜索 | 上传/新建 | 用户（主题切换 + 退出登录）。
// 结构偏离说明：vendored GlassDock（PATH B 编译件）items API 只支持 icon+onClick 的裸 button，
// 无法内嵌 DropdownMenu；故「用户」做 dock 同栏相邻控件（同一玻璃条内、分隔线隔开），
// 视觉分组不变。TODO(Task 13 swap)：registry 源码恢复后评估把用户项收回 dock 内部。
// DockActions 本任务只以 noop 渲染（搜索的命令面板/上传/新建弹窗由 Task 7/8/9 注入实现）。
import { Command, FolderPlus, Home, LogOut, SunMoon, Trash2, Upload } from 'lucide-react'
import { useNavigate } from 'react-router'
import { GlassDock, type GlassDockItem } from '@/components/glinui/components/glass-dock'
import { Avatar } from '@/components/glinui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/glinui/components/dropdown-menu'
import { useTheme } from '@/providers/theme'
import { authActions, useAuth } from '@/stores/auth'

export interface DockActions {
  onUpload(): void
  onSearch(): void
  onNewFolder(): void
}

const noop = () => undefined

// TODO(Task 8/9/13)：真实实现注入点——onUpload=上传对话框（input/分片流程，Task 8）、onNewFolder=新建目录
// modal（Task 9）、onSearch=命令面板（vendored command/cmdk 已可用；**Task 13** registry swap 后接线——
// 修复轮 1 更正旧指针「随 Task 7 落地」：Task 7 裁定搜索入口为 TopBar 输入框 ?q=，面板 UI 顺延 Task 13）。
export const noopDockActions: DockActions = { onUpload: noop, onSearch: noop, onNewFolder: noop }

export function Dock({ actions = noopDockActions }: { actions?: DockActions }) {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const username = useAuth((state) => state.user?.username ?? '')

  const items: GlassDockItem[] = [
    { id: 'files', icon: <Home size={22} />, label: '全部文件', onClick: () => navigate('/files') },
    { id: 'trash', icon: <Trash2 size={22} />, label: '回收站', onClick: () => navigate('/trash') },
    { id: 'search', icon: <Command size={22} />, label: '搜索', onClick: actions.onSearch },
    { id: 'upload', icon: <Upload size={22} />, label: '上传', onClick: actions.onUpload },
    { id: 'new-folder', icon: <FolderPlus size={22} />, label: '新建文件夹', onClick: actions.onNewFolder },
  ]

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center">
      <div
        data-testid="dock"
        className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-2 shadow-lg backdrop-blur-xl"
      >
        {/* 玻璃条样式统一放在外层容器，dock 本体去背景避免双层边框 */}
        <GlassDock items={items} iconSize={40} className="border-0 bg-transparent p-0 shadow-none backdrop-blur-none" />
        <span aria-hidden="true" className="mx-1 h-10 w-px bg-white/15" />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="用户菜单"
            className="flex items-center justify-center rounded-xl bg-white/10 p-2 transition-shadow duration-200 hover:shadow-md"
          >
            <Avatar size="sm" fallback={(username.slice(0, 1) || 'U').toUpperCase()} alt="用户" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-40">
            <DropdownMenuItem onSelect={toggle}>
              <SunMoon size={16} />
              切换主题（当前：{theme === 'dark' ? '暗色' : '亮色'}）
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                authActions.clear() // 会话清空（store + sessionStorage 三键）；与 401 处理同语义
                navigate('/login')
              }}
            >
              <LogOut size={16} />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
