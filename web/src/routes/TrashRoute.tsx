// /trash 路由组件（Task 11）：Task 4 的「回收站占位」兑现为真实 TrashPage。
// data-testid="trash-route" 保留（占位期即有锚点，测试/外壳导航同约定，与 files-route 对齐）。
import { TrashPage } from '@/features/trash/TrashPage'

export function TrashRoute() {
  return (
    <div data-testid="trash-route">
      <TrashPage />
    </div>
  )
}
