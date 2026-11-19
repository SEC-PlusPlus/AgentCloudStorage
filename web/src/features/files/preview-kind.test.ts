// Task 10 预览类型判定表驱动锚：扩展名集合逐条对照旧 FileWorkbench（adbcfba web/src/pages/
// FileWorkbench.vue:20-26 previewTypes）移植——image=png/jpg/jpeg/gif/webp/avif、pdf=pdf、
// text=txt/md/log/csv（旧版无 json/code/svg，故它们按 mime 双判兜底或 download-only，见钉死用例）；
// video 为旧版没有的新增集（brief §115 钉 image/video/pdf/text 四分支）。
// mime 双判（spec「按扩展名+mime 双判」）：ct 前缀 image//video//text/ 与 application/pdf
// 参与判定；扩展名大小写不敏感；ct 参数串（;charset=…）剥离。
import { describe, expect, it } from 'vitest'
import { TEXT_PREVIEW_KINDS, previewKind } from './preview-kind'

describe('previewKind：扩展名+mime 双判（旧 adbcfba 集合逐条对照）', () => {
  it.each([
    // —— image：旧 previewTypes 六扩展名 + mime 兜底
    ['image/png', 'photo.png', 'image'],
    ['application/octet-stream', 'a.jpg', 'image'],
    ['application/octet-stream', 'a.jpeg', 'image'],
    ['application/octet-stream', 'a.gif', 'image'],
    ['application/octet-stream', 'a.webp', 'image'],
    ['application/octet-stream', 'a.avif', 'image'],
    ['image/jpeg', 'no-dot-name', 'image'], // 无扩展名时旧语义整名当 ext 查——查不到由 ct 双判放行
    ['IMAGE/PNG', 'PHOTO.PNG', 'image'], // 大写 ext + 大写 mime
    ['application/octet-stream', '归档.照片.PNG', 'image'], // 多段名取尾段
    ['image/svg+xml', 'icon.svg', 'image'], // 旧 ext 表无 svg（不发明），ct=image/* 双判放行
    // —— video：旧版无预览，brief 钉 .mp4→video；其余 webm/mov 同族
    ['application/octet-stream', 'clip.mp4', 'video'],
    ['video/mp4', 'clip.xyz', 'video'],
    ['application/octet-stream', 'CLIP.WEBM', 'video'],
    // —— pdf
    ['application/pdf', 'doc.pdf', 'pdf'],
    ['application/octet-stream', 'DOC.PDF', 'pdf'],
    // —— text：旧 previewTypes text 四扩展名逐条
    ['application/octet-stream', 'notes.md', 'text'],
    ['application/octet-stream', 'a.txt', 'text'],
    ['application/octet-stream', 'server.log', 'text'],
    ['application/octet-stream', 'data.csv', 'text'],
    ['text/plain; charset=utf-8', 'README', 'text'], // ct 参数串剥离 + 无扩展名 ct 兜底
    ['text/markdown', 'no-dot-name', 'text'],
    // —— download-only：旧 canPreview=false 的集合（octet 流/压缩包/旧版不支持的类型）
    ['application/octet-stream', 'data', 'download-only'], // brief 钉：无扩展名+octet
    ['application/octet-stream', 'archive.zip', 'download-only'],
    ['application/json', 'data.json', 'download-only'], // 旧版 previewTypes 无 json——逐条对照移植=不扩集
  ])('%s + %s → %s', (contentType, name, expected) => {
    expect(previewKind(contentType, name)).toBe(expected)
  })

  it('text/ 前缀 mime 一律判 text（扩展名无关，双判纪律）', () => {
    expect(previewKind('text/x-python', 'script.py')).toBe('text')
  })

  it('空 contentType 时纯扩展名判定仍生效；两者皆陌生 → download-only', () => {
    expect(previewKind('', 'notes.md')).toBe('text')
    expect(previewKind('', 'mystery')).toBe('download-only')
    expect(previewKind('', 'no.dots.here.bin')).toBe('download-only')
  })

  it('TEXT_PREVIEW_KINDS = 旧版 text 集合逐字（Task 12 canAsk 复用锚）', () => {
    expect(TEXT_PREVIEW_KINDS).toEqual(['txt', 'md', 'log', 'csv'])
  })
})
