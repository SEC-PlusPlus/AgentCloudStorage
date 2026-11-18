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
