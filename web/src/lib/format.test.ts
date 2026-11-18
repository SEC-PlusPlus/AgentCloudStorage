import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate } from '@/lib/format'

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
