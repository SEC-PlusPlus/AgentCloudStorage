// Task 1-A（布局密度）：file-icons 表驱动锚——七类映射各 ≥1 例 + 边界（无扩展名=整名当 ext 查表、
// 大写扩展名、octet mime 兜底、mime 家族第二判据、跨判序 image>video>audio>pdf>archive>text）。
// 扩展名提取与 preview-kind 同源（extensionOf），本测试同时锁「IMAGE/VIDEO/TEXT 集合复用不漂移」。
import { File, FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { FILE_ICON_BY_KIND, FOLDER_ICON, classifyFileIcon, fileIcon } from './file-icons'

describe('classifyFileIcon：ext 主判（preview-kind 同款取名法）', () => {
  it.each([
    ['photo.png', 'image'],
    ['a.JPG', 'image'], // 大写扩展名（extensionOf 已 toLowerCase）
    ['x.avif', 'image'],
    ['clip.mp4', 'video'],
    ['movie.MOV', 'video'],
    ['song.mp3', 'audio'],
    ['take.m4a', 'audio'],
    ['pack.zip', 'archive'],
    ['backup.tar.gz', 'archive'], // 无头怪癖同源：split('.').pop()='gz' 仍中压缩包集
    ['main.go', 'code'],
    ['app.tsx', 'code'],
    ['note.md', 'code'], // TEXT_PREVIEW_KINDS 并入 code/text 图标族
    ['doc.pdf', 'pdf'],
  ] as const)('%s → %s', (name, kind) => {
    expect(classifyFileIcon(name, 'application/octet-stream')).toBe(kind)
  })
})

describe('classifyFileIcon：mime 第二判据（ext 不认识时兜住）', () => {
  it.each([
    ['frame.xyz', 'image/svg+xml', 'image'],
    ['stream.unknown', 'video/webm', 'video'],
    ['track.unknown', 'audio/mpeg', 'audio'],
    ['report.unknown', 'application/pdf', 'pdf'],
    ['bundle.unknown', 'application/zip', 'archive'],
    ['DATA.CSV', 'application/octet-stream', 'code'], // 大写 ext 命中 TEXT 集
    ['README', 'text/markdown', 'code'], // 无点文件名整名当 ext 查表不中 → text/* mime 接住
  ] as const)('%s + %s → %s', (name, ct, kind) => {
    expect(classifyFileIcon(name, ct)).toBe(kind)
  })
})

describe('classifyFileIcon：兜底与判序', () => {
  it('octet mime + 未知/无扩展名 → file（默认 File 图标）', () => {
    expect(classifyFileIcon('LICENSE', 'application/octet-stream')).toBe('file')
    expect(classifyFileIcon('blob.bin', '')).toBe('file') // 空 contentType 容错
    expect(classifyFileIcon('', 'application/octet-stream')).toBe('file')
  })

  it('跨族冲突按判定序 image > video > audio > pdf > archive > text（同 preview-kind 双判纪律）', () => {
    expect(classifyFileIcon('a.png', 'video/mp4')).toBe('image')
    expect(classifyFileIcon('a.mp4', 'audio/mpeg')).toBe('video')
    expect(classifyFileIcon('a.log', 'video/mp4')).toBe('video') // 后族 ext 不赢前族 mime——镜像 preview-kind Minor-4
  })
})

describe('fileIcon：kind → Lucide 组件映射', () => {
  it.each([
    ['photo.png', FileImage],
    ['clip.webm', FileVideo],
    ['song.flac', FileAudio],
    ['pack.7z', FileArchive],
    ['doc.pdf', FileText],
    ['main.py', FileCode],
    ['mystery.xyz', File],
  ] as const)('%s → %o', (name, icon) => {
    expect(fileIcon(name, 'application/octet-stream')).toBe(icon)
  })

  it('FILE_ICON_BY_KIND 全覆盖联合（B 详情面板大图标同源消费）', () => {
    expect(Object.keys(FILE_ICON_BY_KIND).sort()).toEqual(
      ['archive', 'audio', 'code', 'file', 'image', 'pdf', 'video'].sort(),
    )
  })
})

it('FOLDER_ICON=Folder（文件夹不进 fileIcon 签名——FileRow 判别在调用侧 kind）', () => {
  expect(FOLDER_ICON).toBe(Folder)
})
