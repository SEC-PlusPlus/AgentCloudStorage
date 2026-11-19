// 预览类型判定（Task 10 / spec §5.2「按扩展名+mime 双判」）。
// 扩展名集合逐条对照旧 FileWorkbench（adbcfba web/src/pages/FileWorkbench.vue:20-26 previewTypes）移植：
//   image = png/jpg/jpeg/gif/webp/avif；pdf = pdf；text = txt/md/log/csv。
// 旧版无 video 预览，video 集为新版新增（brief 四分支 image/video/pdf/text）；svg/json/code 旧表均无，
// 「逐条对照移植=不扩集」——它们只经 mime 双判兜底（如 ct=image/svg+xml、text/*）或落 download-only。
// 旧版取扩展名即 `name.split('.').pop().toLowerCase()`——无点文件名整名当 ext 查表（查不到自然不匹配），
// 原语义原样保留（如名为「pdf」的旧版可预览，新版同样判 pdf，属逐字对照而非缺陷）。
export type PreviewKind = 'image' | 'video' | 'pdf' | 'text' | 'download-only'

/** 旧 previewTypes image 六项逐字（adbcfba:21-23）。 */
export const IMAGE_PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] as const
/** 旧版无 video 预览——新增集（预览走原生 video 标签，仅列浏览器普遍可播容器）。 */
export const VIDEO_PREVIEW_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'] as const
/** 旧 previewTypes text 四项逐字（adbcfba:24-26）；Task 12 问答 canAsk 复用此集。 */
export const TEXT_PREVIEW_KINDS = ['txt', 'md', 'log', 'csv'] as const

/** 旧版同款扩展名提取（含无点=整名语义，逐字对照见头注）。 */
export function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

/**
 * contentType + 文件名双判：ext 命中旧集合优先（octet-stream 兜底存储下仍可预览），
 * mime 家族前缀（image/ video/ text/）与 application/pdf 作第二判据；皆不命中 → download-only。
 */
export function previewKind(contentType: string, name: string): PreviewKind {
  const ext = extensionOf(name)
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
  const inSet = (set: readonly string[]) => (set as readonly string[]).includes(ext)
  if (inSet(IMAGE_PREVIEW_EXTENSIONS) || ct.startsWith('image/')) return 'image'
  if (inSet(VIDEO_PREVIEW_EXTENSIONS) || ct.startsWith('video/')) return 'video'
  if (ext === 'pdf' || ct === 'application/pdf') return 'pdf'
  if (inSet(TEXT_PREVIEW_KINDS) || ct.startsWith('text/')) return 'text'
  return 'download-only'
}
