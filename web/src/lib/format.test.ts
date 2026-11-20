import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatBytes, formatDate, formatRelative } from '@/lib/format'

describe('formatBytes（旧 FileWorkbench formatSize 同式："1.2 GB" 风格）', () => {
  it('0 → "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('B 段与 1024 边界', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('KB 段', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('MB 段与 ≥100 取整', () => {
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(Math.round(1.2 * 1024 ** 2))).toBe('1.2 MB')
    expect(formatBytes(100 * 1024 ** 2)).toBe('100 MB')
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB')
  })

  it('GB 段', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(Math.round(1.2 * 1024 ** 3))).toBe('1.2 GB')
  })

  it('TB 封顶（超过不再进位）', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB')
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB')
  })
})

describe('formatDate（本地日期 YYYY-MM-DD）', () => {
  it('本地正午 ISO 往返 → YYYY-MM-DD', () => {
    const iso = new Date(2026, 10, 19, 12, 0, 0).toISOString()
    expect(formatDate(iso)).toBe('2026-11-19')
  })

  it('月/日补零', () => {
    const iso = new Date(2026, 0, 5, 12, 0, 0).toISOString()
    expect(formatDate(iso)).toBe('2026-01-05')
  })
})

// Task 3-C 追加：相对时间（今日/昨日/N 天前，≥7 天回退 formatDate）。
// 表驱动钉「本地正午锚定」纪律（同 formatDate 用例）：now 冻结在本地 12:00、用例日期也取正午附近，
// 任何时区下日历日差恒定——UTC 偏移不再能翻转边界（brief 判序：先差日历日、后回退绝对日期）。
describe('formatRelative（今天/昨天/N 天前，7 天界回退日期）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 10, 20, 12, 0, 0).getTime() }) // 本地 2026-11-20 12:00
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const isoNoon = (dayOffset: number) =>
    new Date(2026, 10, 20 + dayOffset, 12, 0, 0).toISOString()

  const table: Array<[label: string, offset: number, want: string]> = [
    ['今天（offset 0）', 0, '今天'],
    ['昨天', -1, '昨天'],
    ['2 天前', -2, '2 天前'],
    ['6 天前（相对窗上界）', -6, '6 天前'],
    ['7 天前（回退绝对日期）', -7, '2026-11-13'],
    ['30 天前（回退绝对日期）', -30, '2026-10-21'],
  ]
  it.each(table)('%s', (_label, offset, want) => {
    expect(formatRelative(isoNoon(offset))).toBe(want)
  })

  it('未来时间（客户端时钟偏后）→ 今天（负差按今天吸收，不出现「-1 天前」）', () => {
    expect(formatRelative(isoNoon(3))).toBe('今天')
  })

  it('跨月边界按日历日差（正午锚定：11-20 → 10-31 = 20 天）', () => {
    expect(formatRelative(new Date(2026, 9, 31, 12, 0, 0).toISOString())).toBe('2026-10-31')
    expect(formatRelative(new Date(2026, 10, 19, 12, 0, 0).toISOString())).toBe('昨天')
  })

  it('非正午输入按本地日历日界（当日 23:00→今天；未来日 11-21 01:00 负差吸收→今天；前日 23:00→昨天）', () => {
    expect(formatRelative(new Date(2026, 10, 20, 23, 0, 0).toISOString())).toBe('今天')
    expect(formatRelative(new Date(2026, 10, 21, 1, 0, 0).toISOString())).toBe('今天')
    expect(formatRelative(new Date(2026, 10, 19, 23, 0, 0).toISOString())).toBe('昨天')
  })
})
