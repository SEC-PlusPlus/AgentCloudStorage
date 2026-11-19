// 预览类型判定（Task 10 / spec §5.2「按扩展名+mime 双判」）。
// 扩展名集合逐条对照旧 FileWorkbench（adbcfba web/src/pages/FileWorkbench.vue:20-26 previewTypes）移植：
//   image = png/jpg/jpeg/gif/webp/avif；pdf = pdf；text = txt/md/log/csv。
// 旧版无 video 预览，video 集为新版新增（brief 四分支 image/video/pdf/text）；svg/json/code 旧表均无，
// 「逐条对照移植=不扩集」——它们只经 mime 双判兜底（如 ct=image/svg+xml、text/*）或落 download-only。
// 旧版取扩展名即 `name.split('.').pop().toLowerCase()`——无点文件名整名当 ext 查表（查不到自然不匹配），
// 原语义原样保留（如名为「pdf」的旧版可预览，新版同样判 pdf，属逐字对照而非缺陷）。
// 双判优先序声明（T13 carry #18 / Task 10 Minor-4）：同族内 ext 命中与 ct 前缀等价（任一即归该族）；
// 跨族冲突按判定序 image > video > pdf > text 先到先得——ct-family 先于后族 ext 判走，
// 例：`.log` + ct=`video/mp4` 归 video（text-ext 不赢）。旧版单 ct 判定，跨族歧义为新增面。
export type PreviewKind = 'image' | 'video' | 'pdf' | 'text' | 'download-only'

/** 旧 previewTypes image 六项逐字（adbcfba:21-23）。 */
export const IMAGE_PREVIEW_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] as const
/** 旧版无 video 预览——新增集（预览走原生 video 标签，仅列浏览器普遍可播容器）。 */
export const VIDEO_PREVIEW_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'] as const
/**
 * 旧 previewTypes text 四项逐字（adbcfba:24-26）。
 * ⚠ 修复轮 1 / Minor-5：预览 text 集合 ≠ 旧 canAsk 集合——旧版提问白名单是更窄的
 * /\.(txt|md)$/i（adbcfba:322，无 log/csv）。Task 12 实现 canAsk 时**勿直接复用本数组**，
 * 需按旧 canAsk 正则单独移植。
 */
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

/**
 * blob 型别规范化表——旧 previewTypes 的 mime 值逐条对照（adbcfba:20-26：png→image/png、
 * jpg/jpeg→image/jpeg、gif/webp/avif、pdf→application/pdf、text 四项→text/plain）。
 * 后端如实存浏览器上报 Content-Type（upload_handler.go:46/file_handler.go:126），无类型上传落
 * application/octet-stream——octet blob 直喂 iframe/video 时 Chromium 不内渲（评审修复轮 1
 * / Important-1：首实现仅传 row.contentType 丢了旧版「按 ext 规范化 MIME 再喂 blob」修正）。
 * video 族旧表无（旧版不预览视频），按浏览器容器惯例补 canonical 值。
 */
const CANONICAL_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogv: 'video/ogg',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/plain', log: 'text/plain', csv: 'text/plain',
}

/**
 * 喂 fetchFileContent 的第二参（blob type 覆盖）：contentType 为空或 octet-stream 时用表值
 * （ext 也不认识则 undefined=blob 原样）；其余真实 type 原样采信。
 */
export function resolveBlobContentType(contentType: string, name: string): string | undefined {
  const ct = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  if (ct !== '' && ct !== 'application/octet-stream') return ct
  return CANONICAL_MIME_BY_EXT[extensionOf(name)]
}
