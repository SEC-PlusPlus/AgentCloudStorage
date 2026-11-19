// /files 路由组件（Task 7）：Task 4 的「文件工作台占位」兑现为真实 FilesPage。
// data-testid="files-route" 保留（401 接线测试锚点，与 login-route 同约定）。
import { FilesPage } from '@/features/files/FilesPage'

export function FilesRoute() {
  return (
    <div data-testid="files-route">
      <FilesPage />
    </div>
  )
}
