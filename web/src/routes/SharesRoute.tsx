// /shares 路由组件（Task W2）：外壳锚点与 files-route/trash-route 同约定（占位期即有 data-testid，
// 测试/外壳导航统一），内容为真实 SharesPage。
import { SharesPage } from '@/features/shares/SharesPage'

export function SharesRoute() {
  return (
    <div data-testid="shares-route">
      <SharesPage />
    </div>
  )
}
