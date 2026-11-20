// 移植自旧 Vue 版 web/src/pages/FileWorkbench.vue:82-92（formatSize/formatDate），按 brief 改名并统一日期格式。
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // 理由：unit 由 while 上限约束恒在 0..units.length-1，?? 仅收窄 noUncheckedIndexedAccess
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit] ?? 'TB'}`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 相对时间（Task 3-C 仪表盘卡片消费；formatBytes/formatDate 导出面不动）：
 * 今天 / 昨天 / N 天前（N=2..6），日历日差 ≥7 回退 formatDate 绝对日期。
 * 差值按**本地日历日**计算（两侧各自归零到 00:00 后取整除）——DST 23/25 小时日经 round 归稳；
 * 未来日/同日（含客户端时钟偏差负差）吸收进「今天」，不出现「-1 天前」。
 * 输入依赖服务端恒 ISO（同 formatDate 纪律，不做 NaN 兜底）。
 */
export function formatRelative(iso: string): string {
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000)
  if (dayDiff <= 0) return '今天'
  if (dayDiff === 1) return '昨天'
  if (dayDiff < 7) return `${dayDiff} 天前`
  return formatDate(iso)
}
