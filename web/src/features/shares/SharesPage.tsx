// 「我的分享」管理页（Task W2 / W 轨 spec §1.1）：GET /api/v1/shares 属主列表——
// 列集：文件快照名 / 链接（中段省略展示 + 复制钮，title 保全 URL）/ 有效期（formatDate | 永久）/
// 下载次数 / 状态 / 操作（撤销）。
// 状态列 RULING（design §1.1，builder-check 同调）：**只标事实态**——revoked→「已撤销」、
// expires_at 早于当下→「已过期」、其余→「未到期」；绝无「有效」措辞（shareResponse 无文件状态字段，
// 回收站死链前端不可见；backlog：后端补 file_status 后升级「链接失效」标签），渲染零探测（不做 N+1）。
// 已撤销行不显示撤销钮（revoked 优先于过期判定）。撤销=直按（brief 定夺，无确认弹窗——可重新分享，
// 非不可逆销毁，区别于回收站永久删除的 alert-dialog 闸）：DELETE 204 → toast「分享已撤销。」+
// invalidate ['shares']（ListByOwner 含 revoked 行 → 重取行内状态更新非消失）。
// 复制红线（spec §7）：token 即凭证，仅显式点击「复制」才写剪贴板；clipboard 不可用/被拒回退
// 行内隐藏只读 input 全文选中（ShareDialog urlRef.select 同纪律——表格单元格是截断展示文本，
// 不可直接选中给用户 Ctrl+C，故藏全 URL 于 input），不报错不打断。
// 样式沿 FilesTable/TrashPage 玻璃行语言：Table variant="glass" + 内滚常量/容器类单源共享。
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/glinui/components/alert'
import { Badge } from '@/components/glinui/components/badge'
import { Button } from '@/components/glinui/components/button'
import { Skeleton } from '@/components/glinui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/glinui/components/table'
import { Empty } from '@/components/app/Empty'
import { ApiError } from '@/api/client'
import { listShares, revokeShare, shareUrl, type ShareItem } from '@/api/shares'
import { mutationErrorMessage } from '@/features/files/actions'
import { LIST_SCROLL_CONTAINER_CLASS, listScrollFrameStyle } from '@/features/files/FilesTable'
import { formatDate } from '@/lib/format'

const LOADING_ROWS = 5

/** 状态列纯函数（RULING 三态；now 注入便于钉测，默认墙钟——无未来时间 fixture 诉求）。 */
export function shareStatusLabel(item: ShareItem, now: Date = new Date()): string {
  if (item.revoked) return '已撤销'
  if (item.expires_at && new Date(item.expires_at).getTime() < now.getTime()) return '已过期'
  return '未到期'
}

/** 状态→Badge 色调（事实态视觉分层：撤销红、过期琥珀、未到期中性玻璃）。 */
const STATUS_VARIANT = {
  已撤销: 'destructive',
  已过期: 'warning',
  未到期: 'glass',
} as const

/** 链接列中段省略（全 URL 的 token 尾部信息量最高，掐中间保头尾可辨；纯函数钉测）。 */
export function middleEllipsis(text: string, head = 26, tail = 9): string {
  if (text.length <= head + 1 + tail) return text
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

export function SharesPage() {
  const queryClient = useQueryClient()
  const listQuery = useQuery({ queryKey: ['shares'], queryFn: () => listShares() })
  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data])

  const [busyToken, setBusyToken] = useState<string | null>(null)
  // clipboard 回退用：每行一个隐藏只读 input（值为全 URL），拒绝时 select() 交还用户 Ctrl+C。
  const copyInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const revokeMutation = useMutation({
    // vars 入参非闭包捕获（ShareDialog/MoveDialog 同款纪律）。
    mutationFn: (token: string) => revokeShare(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] })
      toast('分享已撤销。')
    },
    onError: (error) => toast.error(mutationErrorMessage(error)),
  })

  const runRevoke = async (item: ShareItem) => {
    setBusyToken(item.token)
    try {
      await revokeMutation.mutateAsync(item.token)
    } catch {
      // 失败 toast 已在 mutation onError 统一给出，这里只收 busy。
    } finally {
      setBusyToken(null)
    }
  }

  const copyLink = async (item: ShareItem) => {
    const url = shareUrl(item.token)
    try {
      await navigator.clipboard.writeText(url)
      toast('链接已复制到剪贴板。')
    } catch {
      // clipboard 缺失/权限拒绝：回退选中隐藏 input 全文（不弹错误免噪音，ShareDialog 同纪律）。
      copyInputRefs.current[item.token]?.select()
    }
  }

  const isPending = listQuery.isPending
  const isError = listQuery.isError

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3" data-testid="shares-page">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-medium text-[var(--color-foreground)]">我的分享</h1>
        {!isPending && !isError ? <Badge variant="glass">{items.length} 个分享</Badge> : null}
      </div>
      <p className="text-sm text-[var(--color-foreground)] opacity-70">
        这里列出你创建过的分享链接，可随时撤销。
      </p>

      {isPending ? (
        <div aria-busy="true" data-testid="shares-loading" className="flex flex-col gap-2">
          <p role="status" className="text-sm text-[var(--color-foreground)] opacity-70">
            正在读取分享列表…
          </p>
          <Table variant="glass" rowDividers containerClassName="overflow-x-auto">
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>链接</TableHead>
                <TableHead className="w-32">有效期</TableHead>
                <TableHead align="right" className="w-24">下载次数</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead align="right" className="w-36">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: LOADING_ROWS }, (_, index) => (
                <TableRow key={index} aria-hidden="true">
                  <TableCell><Skeleton className="h-4 w-2/3" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-3/4" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8 justify-self-end" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24 justify-self-end" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : isError ? (
        <Alert variant="destructive" data-testid="shares-error">
          <AlertDescription>
            {listQuery.error instanceof ApiError
              ? listQuery.error.message
              : '暂时无法读取分享列表。'}
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Empty title="还没有创建过分享。" description="在文件上右键选择「分享」生成链接。" />
      ) : (
        <div className="contents" style={listScrollFrameStyle}>
          <Table variant="glass" interactive rowDividers stickyHeader containerClassName={LIST_SCROLL_CONTAINER_CLASS}>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>链接</TableHead>
                <TableHead className="w-32">有效期</TableHead>
                <TableHead align="right" className="w-24">下载次数</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead align="right" className="w-36">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const url = shareUrl(item.token)
                const status = shareStatusLabel(item)
                return (
                  <TableRow key={item.token} data-testid={`share-row-${item.display_name}`}>
                    <TableCell truncate>{item.display_name}</TableCell>
                    <TableCell truncate>
                      <span title={url} data-testid={`share-url-${item.token}`}>
                        {middleEllipsis(url)}
                      </span>
                      {/* clipboard 回退载体：全 URL 常驻（sr-only 不可见不可聚焦），拒绝时程序化选中 */}
                      <input
                        ref={(el) => { copyInputRefs.current[item.token] = el }}
                        data-testid={`share-copy-input-${item.token}`}
                        aria-hidden="true"
                        tabIndex={-1}
                        readOnly
                        value={url}
                        className="sr-only"
                      />
                    </TableCell>
                    <TableCell className="tabular-nums opacity-80">
                      {item.expires_at ? formatDate(item.expires_at) : '永久'}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums opacity-80">
                      {item.download_count}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[status as keyof typeof STATUS_VARIANT]}>{status}</Badge>
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="glass" onClick={() => void copyLink(item)}>
                          <Copy size={14} /> 复制
                        </Button>
                        {!item.revoked ? (
                          <Button
                            size="sm"
                            variant="glass"
                            className="text-red-600 dark:text-red-400"
                            disabled={busyToken === item.token}
                            onClick={() => void runRevoke(item)}
                          >
                            撤销
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
