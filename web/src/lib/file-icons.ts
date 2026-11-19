// 行首类型图标（Task 1-A / 布局密度）：name+contentType 双判 → lucide 图标组件。
// 判据与 preview-kind.ts 同源纪律：扩展名提取直接 import `extensionOf`（含「无点文件名整名当 ext」
// 旧语义，不改 preview-kind 导出面）；image/video 族与 text 族逐字复用其导出的三张集数组，
// 杜绝两表漂移（音频/压缩包/代码族 preview-kind 无对应集——它们不参与预览判定，本文件新建）。
// 跨族冲突判序镜像 preview-kind 双判声明（Task 10 Minor-4 同纪律）：image > video > audio > pdf >
// archive > code/text，ext 命中与 mime 前缀同族等价、前族先吃。全不中 → File（octet 兜底）。
// 文件夹不在本签名内（FileRow 的 kind 判别在调用侧）：导出 FOLDER_ICON 供 B 详情面板同源消费。
import { File, FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder, type LucideIcon } from 'lucide-react'
import {
  IMAGE_PREVIEW_EXTENSIONS,
  TEXT_PREVIEW_KINDS,
  VIDEO_PREVIEW_EXTENSIONS,
  extensionOf,
} from '@/features/files/preview-kind'

export type FileIconKind = 'image' | 'video' | 'audio' | 'archive' | 'pdf' | 'code' | 'file'

/** 音频容器/编码常用扩展（预览族无此集——纯图标分类，独立新建）。 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'oga', 'opus', 'wma'] as const
/** 压缩包集（ext 主判；zip 另给 mime 第二判据，octet 落库时 ext 仍可救）。 */
const ARCHIVE_EXTENSIONS = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'] as const
/**
 * 代码/文本图标族 = TEXT_PREVIEW_KINDS（txt/md/log/csv，复用 import 不复制）+ 常见源码/配置扩展。
 * 与预览 text 判定不同集（图标族更宽是有意分层——FileCode 只表示「文本形态」，不代表可预览）。
 */
const CODE_EXTENSIONS = [
  ...TEXT_PREVIEW_KINDS,
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp',
  'cs', 'rb', 'php', 'swift', 'sh', 'bash', 'ps1', 'bat', 'sql', 'html', 'css', 'scss', 'less',
  'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'conf', 'vue', 'svelte',
] as const

/** 类型 → Lucide 组件（B 详情面板大图标按同表渲染，尺寸在调用侧）。 */
export const FILE_ICON_BY_KIND: Record<FileIconKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  pdf: FileText,
  code: FileCode,
  file: File,
}

/** 文件夹图标（行组件按 row.kind 判别后用；与 fileIcon 返回型一致便于统一渲染）。 */
export const FOLDER_ICON: LucideIcon = Folder

/**
 * 类型色相托底（icon-frame 缺位裁定 2026-11-20：`icon-frame` 不在 vendored 清单——
 * components/ 31 件 + 全包 grep 0 命中，registry 不可达（A3）无法补拉 → 按 brief 降级
 * span+类名自绘 icon-frame 等价托底层，勿再找 import；registry swap 窗口落地后统一替换）。
 * 配色纪律：tokens 实存仅 6 色（accent/foreground/surface/border/background/accent-foreground），
 * 无 type 语义色可用 → 沿用 vendored table.js rowTone 同款 hue 词汇表（sky/emerald/amber/rose）
 * 外扩充 violet，深浅双档；文件夹走品牌 accent。偏离 tokens-only 系 tokens 面不足，非随手上色。
 */
export const FILE_ICON_TONE_CLASS: Record<FileIconKind, string> = {
  image: 'text-emerald-500 dark:text-emerald-400',
  video: 'text-sky-500 dark:text-sky-400',
  audio: 'text-violet-500 dark:text-violet-400',
  archive: 'text-amber-500 dark:text-amber-400',
  pdf: 'text-rose-500 dark:text-rose-400',
  code: 'text-[var(--color-foreground)] opacity-70',
  file: 'text-[var(--color-foreground)] opacity-50',
}
/** 文件夹色相（与 FILE_ICON_TONE_CLASS 同表位消费）。 */
export const FOLDER_TONE_CLASS = 'text-[var(--color-accent)]'

const inSet = (set: readonly string[], ext: string): boolean => (set as readonly string[]).includes(ext)

/** 双判归类（纯函数）：ext 主判 + mime 家族第二判，判序见头注。 */
export function classifyFileIcon(name: string, contentType: string): FileIconKind {
  const ext = extensionOf(name ?? '')
  const ct = (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  if (inSet(IMAGE_PREVIEW_EXTENSIONS, ext) || ct.startsWith('image/')) return 'image'
  if (inSet(VIDEO_PREVIEW_EXTENSIONS, ext) || ct.startsWith('video/')) return 'video'
  if (inSet(AUDIO_EXTENSIONS, ext) || ct.startsWith('audio/')) return 'audio'
  if (ext === 'pdf' || ct === 'application/pdf') return 'pdf'
  if (inSet(ARCHIVE_EXTENSIONS, ext) || ct === 'application/zip') return 'archive'
  if (inSet(CODE_EXTENSIONS, ext) || ct.startsWith('text/')) return 'code'
  return 'file'
}

/** brief 对外签名：name + mime → 图标组件（色相托底类在行组件侧，见 FilesTable）。 */
export function fileIcon(name: string, contentType: string): LucideIcon {
  return FILE_ICON_BY_KIND[classifyFileIcon(name, contentType)]
}
