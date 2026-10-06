<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../api/client'
import { askFile } from '../api/knowledge'
import {
  cancelMultipartUpload, completeMultipartUpload, createFolder, deleteFolder, downloadFile, fetchFileContent, fetchTextPreview,
  getMultipartUploadProgress, getStorageUsage, listFiles, listFolders, moveFile, moveFolder,
  renameFile, renameFolder, searchFiles, startMultipartUpload, trashFile,
  uploadFile, uploadMultipartPart,
} from '../api/storage'
import type { FileItem, FolderItem, PageInfo } from '../api/storage'
import { auth } from '../stores/auth'

type Entry = { kind: 'file'; item: FileItem } | { kind: 'folder'; item: FolderItem }
type DialogState = { action: 'create' | 'rename' | 'move'; entry?: Entry } | null
type PreviewKind = 'image' | 'pdf' | 'text'
const previewTypes: Record<string, { kind: PreviewKind; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' }, jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' }, gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' }, avif: { kind: 'image', mime: 'image/avif' },
  pdf: { kind: 'pdf', mime: 'application/pdf' }, txt: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'text', mime: 'text/plain' }, log: { kind: 'text', mime: 'text/plain' },
  csv: { kind: 'text', mime: 'text/plain' },
}
const maxPreviewBytes = 100 * 1024 * 1024
const maxTextPreviewBytes = 2 * 1024 * 1024
const route = useRoute()
const router = useRouter()
const folderID = ref(0)
const folderStack = ref<FolderItem[]>([])
const folders = ref<FolderItem[]>([])
const files = ref<FileItem[]>([])
const pageInfo = ref<PageInfo>({ page: 1, page_size: 20, total: 0 })
const usage = ref(0)
const loading = ref(true)
const busy = ref(false)
const errorMessage = ref('')
const toastMessage = ref('')
const queryText = ref('')
const appliedQuery = ref('')
const dialog = ref<DialogState>(null)
const dialogValue = ref('')
const targetID = ref(0)
const folderTargets = ref<Array<{ id: number; label: string }>>([{ id: 0, label: '根目录' }])
const uploadInput = ref<HTMLInputElement | null>(null)
const uploadTask = ref<{ name: string; percent: number; status: string } | null>(null)
const activeSessionID = ref('')
const previewItem = ref<FileItem | null>(null)
const previewKind = ref<PreviewKind | null>(null)
const previewURL = ref('')
const previewText = ref('')
const previewLoading = ref(false)
const previewError = ref('')
const previewTruncated = ref(false)
const askItem = ref<FileItem | null>(null)
const askQuestion = ref('')
const askAnswer = ref('')
const askError = ref('')
const askBusy = ref(false)
const askDialog = ref<HTMLElement | null>(null)
let askGeneration = 0
let askAbort: AbortController | null = null
let askPreviousFocus: HTMLElement | null = null
let askPreviousBodyOverflow = ''
let uploadAbort: AbortController | null = null
let cancelRequested = false
let previewGeneration = 0
let previousBodyOverflow = ''
const modalElement = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
let toastTimer = 0

const isSearching = computed(() => Boolean(appliedQuery.value))
const currentFolder = computed(() => folderStack.value.at(-1))
const title = computed(() => isSearching.value ? '搜索结果' : currentFolder.value?.name ?? '我的文件')
const emptyTitle = computed(() => isSearching.value ? '没有找到匹配的文件' : '这里还没有内容')
const emptyCopy = computed(() => isSearching.value ? '试试更短的关键词，或检查文件名是否拼写正确。' : '上传一个文件，或先创建文件夹，开始整理你的云仓。')

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
function fileGlyph(file: FileItem) {
  const extension = file.original_name.split('.').pop()?.toLowerCase() ?? ''
  if (['png','jpg','jpeg','gif','webp','svg'].includes(extension)) return '▧'
  if (['pdf'].includes(extension)) return '▤'
  if (['zip','rar','7z','gz'].includes(extension)) return '▱'
  if (['mp4','mov','mp3','wav'].includes(extension)) return '▷'
  if (['doc','docx','txt','md'].includes(extension)) return '▤'
  return '▧'
}
function toast(message: string) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMessage.value = '' }, 2800)
}
function apiMessage(error: unknown) {
  if (!(error instanceof ApiError)) return '操作失败，请稍后重试。'
  if (error.status === 404) return '目标不存在，可能已被删除或移动。'
  if (error.status === 409) return error.message
  if (error.status === 413) return '文件过大，单次上传约支持 50 MiB 以内的文件。'
  if (error.status === 507) return '云仓可用空间不足。'
  if (error.status === 400) return '输入内容不符合要求，请检查名称或搜索词。'
  if (error.status === 0) return error.message
  return error.message
}

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [folderResult, fileResult, usageResult] = await Promise.all([
      isSearching.value ? Promise.resolve({ items: [] as FolderItem[] }) : listFolders(folderID.value),
      isSearching.value ? searchFiles(appliedQuery.value, pageInfo.value.page) : listFiles(folderID.value, pageInfo.value.page),
      getStorageUsage(),
    ])
    const lastPage = Math.max(1, Math.ceil(fileResult.pagination.total / fileResult.pagination.page_size))
    if (pageInfo.value.page > lastPage) {
      pageInfo.value.page = lastPage
      const corrected = isSearching.value
        ? await searchFiles(appliedQuery.value, lastPage)
        : await listFiles(folderID.value, lastPage)
      files.value = corrected.items
      pageInfo.value = corrected.pagination
    } else {
      files.value = fileResult.items
      pageInfo.value = fileResult.pagination
    }
    folders.value = folderResult.items
    usage.value = usageResult.used_bytes
  } catch (error) {
    errorMessage.value = apiMessage(error)
  } finally {
    loading.value = false
  }
}
onMounted(() => { void refresh() })
watch(() => route.query.q, (q) => {
  appliedQuery.value = typeof q === 'string' ? q : ''
  queryText.value = appliedQuery.value
  pageInfo.value.page = 1
  void refresh()
})

function openFolder(folder: FolderItem) {
  folderStack.value.push(folder)
  folderID.value = folder.id
  pageInfo.value.page = 1
  appliedQuery.value = ''
  queryText.value = ''
  void router.replace({ name: 'home' })
  void refresh()
}
function navigateBack(index = folderStack.value.length - 2) {
  folderStack.value = index < 0 ? [] : folderStack.value.slice(0, index + 1)
  folderID.value = folderStack.value.at(-1)?.id ?? 0
  pageInfo.value.page = 1
  void refresh()
}
function submitSearch() {
  const keyword = queryText.value.trim()
  if (!keyword) { clearSearch(); return }
  folderStack.value = []
  folderID.value = 0
  pageInfo.value.page = 1
  appliedQuery.value = keyword
  void router.replace({ name: 'home', query: { q: keyword } })
  void refresh()
}
function clearSearch() {
  queryText.value = ''
  appliedQuery.value = ''
  folderStack.value = []
  folderID.value = 0
  pageInfo.value.page = 1
  void router.replace({ name: 'home' })
  void refresh()
}

async function refreshTargets(excludeRoot?: Entry) {
  const excluded = new Set<number>()
  if (excludeRoot?.kind === 'folder') {
    const collectDescendants = async (id: number, depth: number) => {
      if (depth > 20 || excluded.has(id)) return
      excluded.add(id)
      const result = await listFolders(id)
      await Promise.all(result.items.map((folder) => collectDescendants(folder.id, depth + 1)))
    }
    await collectDescendants(excludeRoot.item.id, 0)
  }
  const options: Array<{ id: number; label: string }> = [{ id: 0, label: '根目录' }]
  const collect = async (parent: number, prefix: string, depth: number) => {
    if (depth > 20) return
    const result = await listFolders(parent)
    for (const folder of result.items) {
      if (excluded.has(folder.id)) continue
      const label = `${prefix}${folder.name}`
      options.push({ id: folder.id, label })
      await collect(folder.id, `${label} / `, depth + 1)
    }
  }
  await collect(0, '', 0)
  folderTargets.value = options
}
async function openDialog(action: 'create' | 'rename' | 'move', entry?: Entry) {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value = { action, entry }
  dialogValue.value = ''
  if (action === 'rename' && entry) dialogValue.value = entry.kind === 'file' ? entry.item.original_name : entry.item.name
  if (action === 'move') {
    try {
      await refreshTargets(entry)
      targetID.value = 0
    } catch (error) {
      closeDialog()
      toast(apiMessage(error))
    }
  }
  await nextTick()
  modalElement.value?.querySelector<HTMLElement>('input, select, button')?.focus()
}
function closeDialog() {
  dialog.value = null
  void nextTick(() => previousFocus?.focus())
}
function cycleDialogFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !modalElement.value) return
  const targets = Array.from(modalElement.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'))
  if (!targets.length) return
  const first = targets[0]
  const last = targets[targets.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
async function confirmDialog() {
  const state = dialog.value
  if (!state) return
  busy.value = true
  errorMessage.value = ''
  try {
    if (state.action === 'create') {
      await createFolder(dialogValue.value.trim(), folderID.value)
      toast('文件夹已创建。')
    } else if (state.entry && state.action === 'rename') {
      if (state.entry.kind === 'file') await renameFile(state.entry.item.id, dialogValue.value.trim())
      else await renameFolder(state.entry.item.id, dialogValue.value.trim())
      toast('名称已更新。')
    } else if (state.entry) {
      if (state.entry.kind === 'file') await moveFile(state.entry.item.id, targetID.value)
      else await moveFolder(state.entry.item.id, targetID.value)
      toast('项目已移动。')
    }
    closeDialog()
    await refresh()
  } catch (error) {
    errorMessage.value = apiMessage(error)
  } finally {
    busy.value = false
  }
}
async function removeEntry(entry: Entry) {
  const prompt = entry.kind === 'file'
    ? `将“${entry.item.original_name}”移入回收站？`
    : `删除文件夹“${entry.item.name}”？该操作仅能删除空文件夹。`
  if (!window.confirm(prompt)) return
  busy.value = true
  try {
    if (entry.kind === 'file') await trashFile(entry.item.id)
    else await deleteFolder(entry.item.id)
    toast(entry.kind === 'file' ? '文件已移入回收站。' : '文件夹已删除。')
    await refresh()
  } catch (error) { errorMessage.value = apiMessage(error) }
  finally { busy.value = false }
}
async function startDownload(file: FileItem) {
  busy.value = true
  try { await downloadFile(file); toast('下载已开始。') }
  catch (error) { errorMessage.value = apiMessage(error) }
  finally { busy.value = false }
}
function previewDescriptor(file: FileItem) {
  const extension = file.original_name.split('.').pop()?.toLowerCase() ?? ''
  return previewTypes[extension]
}
function canPreview(file: FileItem) { return Boolean(previewDescriptor(file)) }
function closeActionMenu(event: Event) {
  const menu = event.currentTarget as HTMLElement
  const details = menu.closest('details')
  if (details) details.open = false
}
function canAsk(file: FileItem) { return /\.(txt|md)$/i.test(file.original_name) }
async function openAsk(file: FileItem) {
  if (!canAsk(file)) return
  if (previewItem.value) closePreview()
  if (askItem.value) closeAsk()
  askPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  askPreviousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  askItem.value = file
  askQuestion.value = ''
  askAnswer.value = ''
  askError.value = ''
  await nextTick()
  askDialog.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
}
function closeAsk() {
  if (!askItem.value) return
  askGeneration++
  askAbort?.abort()
  askAbort = null
  askItem.value = null
  askBusy.value = false
  askQuestion.value = ''
  askAnswer.value = ''
  askError.value = ''
  document.body.style.overflow = askPreviousBodyOverflow
  void nextTick(() => askPreviousFocus?.focus())
}
function cycleAskFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !askDialog.value) return
  const targets = Array.from(askDialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])'))
  if (!targets.length) return
  const first = targets[0]
  const last = targets[targets.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
async function submitAsk() {
  const file = askItem.value
  const question = askQuestion.value.trim()
  if (!file || askBusy.value) return
  if (!question) { askError.value = '先输入一个问题。'; return }
  if (file.size > 1 << 20) { askError.value = '当前只支持不超过 1 MiB 的文本文件。'; return }

  const generation = ++askGeneration
  const controller = new AbortController()
  askAbort = controller
  askBusy.value = true
  askError.value = ''
  askAnswer.value = ''
  try {
    const result = await askFile(file.id, question, controller.signal)
    if (generation !== askGeneration) return
    askAnswer.value = result.answer.trim() || '模型没有返回回答，请重试。'
  } catch (error) {
    if (generation !== askGeneration || controller.signal.aborted) return
    askError.value = error instanceof ApiError && error.status === 500
      ? '问答失败。请确认文件为较短的 UTF-8 文本，或稍后重试。'
      : apiMessage(error)
  } finally {
    if (generation === askGeneration) {
      askBusy.value = false
      askAbort = null
    }
  }
}
async function openPreview(file: FileItem) {
  const descriptor = previewDescriptor(file)
  if (!descriptor) return
  if (askItem.value) closeAsk()
  closePreview()
  const generation = ++previewGeneration
  previewItem.value = file
  previewKind.value = descriptor.kind
  previewLoading.value = true
  previewError.value = ''
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  try {
    if (descriptor.kind !== 'text' && file.size > maxPreviewBytes) {
      previewError.value = '文件超过 100 MiB，浏览器预览容易占用过多内存，请下载后查看。'
      return
    }
    if (descriptor.kind === 'text') {
      const result = await fetchTextPreview(file, maxTextPreviewBytes)
      if (generation !== previewGeneration) return
      previewTruncated.value = result.truncated
      previewText.value = await result.blob.text()
    } else {
      const blob = await fetchFileContent(file, descriptor.mime)
      if (generation !== previewGeneration) return
      previewURL.value = URL.createObjectURL(blob)
    }
  } catch (error) {
    if (generation === previewGeneration) previewError.value = apiMessage(error)
  } finally {
    if (generation === previewGeneration) previewLoading.value = false
  }
}
function closePreview() {
  previewGeneration++
  if (previewURL.value) URL.revokeObjectURL(previewURL.value)
  previewURL.value = ''
  previewItem.value = null
  previewKind.value = null
  previewText.value = ''
  previewTruncated.value = false
  previewLoading.value = false
  previewError.value = ''
  document.body.style.overflow = previousBodyOverflow
}
onUnmounted(() => {
  closeAsk()
  closePreview()
  window.clearTimeout(toastTimer)
})
async function uploadSelection(event: Event) {
  const input = event.target as HTMLInputElement
  await uploadFiles(Array.from(input.files ?? []))
  input.value = ''
}
async function uploadFiles(selected: File[]) {
  if (!selected.length) return
  busy.value = true
  errorMessage.value = ''
  let uploaded = 0
  cancelRequested = false
  try {
    for (const file of selected) {
      // Reserve room for multipart/form-data framing under the backend's 50 MiB body cap.
      if (file.size >= 49 * 1024 * 1024) await uploadLargeFile(file, folderID.value)
      else await uploadFile(file, folderID.value)
      uploaded++
    }
    if (cancelRequested) toast('已取消当前大文件上传。')
    else toast(`已上传 ${uploaded} 个文件。`)
    await refresh()
  } catch (error) {
    if (cancelRequested) toast('已取消当前大文件上传。')
    else errorMessage.value = uploaded ? `已上传 ${uploaded} 个文件，其余失败：${apiMessage(error)}` : apiMessage(error)
    await refresh()
  } finally {
    activeSessionID.value = ''
    uploadAbort = null
    uploadTask.value = null
    cancelRequested = false
    busy.value = false
  }
}
type SavedUpload = { id: string; name: string; size: number; lastModified: number; folderID: number; expiresAt: string }
function savedUploadsKey() { return `acs.multipart.${authUserID()}` }
function authUserID() { return auth.user.value?.id ?? 0 }
function readSavedUploads(): SavedUpload[] {
  try { return JSON.parse(localStorage.getItem(savedUploadsKey()) ?? '[]') as SavedUpload[] }
  catch { return [] }
}
function saveUpload(record: SavedUpload) {
  const records = readSavedUploads().filter((item) => item.id !== record.id)
  records.push(record)
  localStorage.setItem(savedUploadsKey(), JSON.stringify(records))
}
function forgetUpload(id: string) {
  localStorage.setItem(savedUploadsKey(), JSON.stringify(readSavedUploads().filter((item) => item.id !== id)))
}
async function uploadLargeFile(file: File, targetFolderID: number) {
  uploadAbort = new AbortController()
  const controller = uploadAbort
  uploadTask.value = { name: file.name, percent: 0, status: '准备上传' }
  const match = (record: SavedUpload) => record.name === file.name && record.size === file.size &&
    record.lastModified === file.lastModified && record.folderID === targetFolderID
  const previous = readSavedUploads().find(match)
  let session: { id: string; part_size: number; expires_at: string } | undefined
  let uploadedParts = new Set<number>()
  if (previous && Date.parse(previous.expiresAt) > Date.now()) {
    try {
      const progress = await getMultipartUploadProgress(previous.id)
      if (progress.status === 2) {
        uploadTask.value.status = '正在恢复合并'
        await completeMultipartUpload(previous.id)
        forgetUpload(previous.id)
        return
      }
      if (progress.status === 3) {
        forgetUpload(previous.id)
        await refresh()
        return
      }
      if (progress.status === 4) {
        forgetUpload(previous.id)
      } else {
        session = { id: progress.id, part_size: progress.part_size, expires_at: progress.expires_at }
        uploadedParts = new Set(progress.uploaded_parts)
        uploadTask.value.status = `续传中 · 已确认 ${uploadedParts.size}/${progress.total_parts} 个分片`
      }
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 409)) throw error
      forgetUpload(previous.id)
    }
    if (!session) session = await startMultipartUpload(file, targetFolderID)
  } else {
    if (previous) forgetUpload(previous.id)
    session = await startMultipartUpload(file, targetFolderID)
  }
  activeSessionID.value = session.id
  const record: SavedUpload = { id: session.id, name: file.name, size: file.size, lastModified: file.lastModified, folderID: targetFolderID, expiresAt: session.expires_at }
  saveUpload(record)
  try {
    if (cancelRequested) throw new DOMException('Upload cancelled', 'AbortError')
    const totalParts = Math.ceil(file.size / session.part_size)
    const calculatePercent = () => Math.min(100, Math.floor(uploadedParts.size / totalParts * 100))
    uploadTask.value.percent = calculatePercent()
    for (let number = 1; number <= totalParts; number++) {
      if (cancelRequested) throw new DOMException('Upload cancelled', 'AbortError')
      if (uploadedParts.has(number)) continue
      const start = (number - 1) * session.part_size
      const part = file.slice(start, Math.min(start + session.part_size, file.size))
      uploadTask.value.status = `上传分片 ${number}/${totalParts}`
      await uploadMultipartPart(session.id, number, part, controller.signal)
      uploadedParts.add(number)
      uploadTask.value.percent = calculatePercent()
      uploadTask.value.status = `已确认 ${uploadedParts.size}/${totalParts} 个分片`
    }
    if (cancelRequested) throw new DOMException('Upload cancelled', 'AbortError')
    uploadTask.value.status = '正在合并文件'
    await completeMultipartUpload(session.id)
    forgetUpload(session.id)
  } catch (error) {
    if (cancelRequested) {
      try { await cancelMultipartUpload(session.id); forgetUpload(session.id) }
      catch (cancelError) { errorMessage.value = apiMessage(cancelError) }
    }
    throw error
  }
}
async function cancelCurrentUpload() {
  if (!uploadTask.value) return
  if (uploadTask.value.status.includes('合并')) return
  cancelRequested = true
  uploadTask.value.status = '正在取消…'
  uploadAbort?.abort()
}
function onDrop(event: DragEvent) {
  if (isSearching.value || !event.dataTransfer?.files.length) return
  event.preventDefault()
  void uploadFiles(Array.from(event.dataTransfer.files))
}
function changePage(page: number) {
  pageInfo.value.page = page
  void refresh()
}
</script>

<template>
  <div class="shell-content workbench" @dragover.prevent @drop="onDrop">
    <div class="workbench-heading">
      <div>
        <div class="workbench-title-row"><h1>{{ title }}</h1><span class="item-count">{{ isSearching ? `${pageInfo.total} 个结果` : `${folders.length + pageInfo.total} 个项目` }}</span></div>
        <p class="workbench-subtitle">{{ isSearching ? `文件名中包含“${appliedQuery}”` : currentFolder ? '此文件夹中的内容' : '你的文件，都在这里。' }}</p>
      </div>
      <div class="usage-chip"><small>已使用空间</small><b>{{ formatSize(usage) }}</b></div>
    </div>

    <div class="workbench-toolbar">
      <div class="crumbs"><button v-if="folderStack.length" type="button" class="back-button" aria-label="返回上级目录" @click="navigateBack()">←</button><button type="button" :class="{ 'crumb-current': !currentFolder && !isSearching }" @click="clearSearch">根目录</button><template v-for="(folder, index) in folderStack" :key="folder.id"><i>/</i><button type="button" :class="{ 'crumb-current': index === folderStack.length - 1 }" @click="navigateBack(index)">{{ folder.name }}</button></template><template v-if="isSearching"><i>/</i><span class="crumb-current">搜索</span></template></div>
      <form class="search-box" role="search" @submit.prevent="submitSearch"><span>⌕</span><input v-model="queryText" aria-label="搜索文件名" placeholder="搜索文件名…" /><button v-if="queryText" type="button" aria-label="清空搜索" @click="clearSearch">×</button><kbd>↵</kbd></form>
      <div class="toolbar-actions"><button class="secondary-action" type="button" :disabled="busy || isSearching" @click="openDialog('create')"><span>＋</span> 新建文件夹</button><button class="primary-action" type="button" :disabled="busy || isSearching" @click="uploadInput?.click()"><span>↑</span> 上传文件</button><input ref="uploadInput" type="file" multiple hidden @change="uploadSelection" /></div>
    </div>

    <div v-if="errorMessage" class="inline-error" role="alert"><span>!</span>{{ errorMessage }}<button type="button" aria-label="关闭错误提示" @click="errorMessage = ''">×</button></div>
    <section v-if="uploadTask" class="upload-progress" aria-live="polite" aria-label="上传进度">
      <div class="upload-progress-heading"><div><b>{{ uploadTask.name }}</b><small>{{ uploadTask.status }}</small></div><strong>{{ uploadTask.percent }}%</strong></div>
      <progress :value="uploadTask.percent" max="100" />
      <button v-if="activeSessionID || uploadTask" type="button" class="cancel-upload" @click="cancelCurrentUpload">取消上传</button>
    </section>
    <div v-if="!isSearching && currentFolder" class="directory-hint"><span>◈</span> 你正在浏览 <b>{{ currentFolder.name }}</b><button type="button" @click="navigateBack()">返回上级</button></div>
    <div v-if="loading" class="loading-state"><span class="loading-orbit" />正在读取云仓…</div>
    <div v-else-if="!folders.length && !files.length" class="empty-workspace file-empty"><div class="empty-orbit"><div class="empty-cloud">{{ isSearching ? '⌕' : '☁' }}</div></div><h2>{{ emptyTitle }}</h2><p>{{ emptyCopy }}</p><button v-if="!isSearching" class="primary-action empty-upload" type="button" @click="uploadInput?.click()">上传文件</button></div>
    <section v-else class="file-table-wrap" aria-label="文件和文件夹列表">
          <div class="file-table-head"><span>名称</span><span>大小</span><span>日期</span><span class="actions-heading">操作</span></div>
      <div v-if="folders.length" class="table-section-label">文件夹 <span>{{ folders.length }}</span></div>
      <div v-for="folder in folders" :key="`folder-${folder.id}`" class="file-row folder-row">
        <button type="button" class="entry-name" @click="openFolder(folder)"><span class="entry-glyph folder-glyph">▰</span><span class="entry-text"><b>{{ folder.name }}</b><small>文件夹</small></span></button>
        <span class="file-meta">—</span><span class="file-meta">{{ formatDate(folder.updated_at) }}</span>
        <div class="row-actions"><details class="entry-more"><summary aria-label="更多文件夹操作">更多</summary><div class="entry-menu" @click="closeActionMenu"><button type="button" @click="openDialog('rename', {kind:'folder',item:folder})">重命名</button><button type="button" @click="openDialog('move', {kind:'folder',item:folder})">移动到</button><button type="button" class="danger-action" @click="removeEntry({kind:'folder',item:folder})">删除文件夹</button></div></details></div>
      </div>
      <div v-if="files.length" class="table-section-label">文件 <span>{{ files.length }}</span></div>
      <div v-for="file in files" :key="`file-${file.id}`" class="file-row">
        <div class="entry-name"><span class="entry-glyph file-glyph">{{ fileGlyph(file) }}</span><span class="entry-text"><b>{{ file.original_name }}</b><small v-if="isSearching">目录 ID · {{ file.folder_id || '根目录' }}</small><small v-else>{{ file.content_type || '未知类型' }}</small></span></div>
        <span class="file-meta">{{ formatSize(file.size) }}</span><span class="file-meta">{{ formatDate(file.created_at) }}</span>
        <div class="row-actions"><button v-if="canPreview(file)" type="button" @click="openPreview(file)">预览</button><button v-if="canAsk(file)" class="ask-entry-action" type="button" @click="openAsk(file)">提问</button><button type="button" @click="startDownload(file)">下载</button><details class="entry-more"><summary aria-label="更多文件操作">更多</summary><div class="entry-menu" @click="closeActionMenu"><button type="button" @click="openDialog('rename', {kind:'file',item:file})">重命名</button><button type="button" @click="openDialog('move', {kind:'file',item:file})">移动到</button><button type="button" class="danger-action" @click="removeEntry({kind:'file',item:file})">移入回收站</button></div></details></div>
      </div>
      <div v-if="pageInfo.total > pageInfo.page_size" class="pagination"><span>共 {{ pageInfo.total }} 个文件</span><div><button type="button" :disabled="pageInfo.page <= 1" @click="changePage(pageInfo.page - 1)">上一页</button><span>{{ pageInfo.page }}</span><button type="button" :disabled="pageInfo.page * pageInfo.page_size >= pageInfo.total" @click="changePage(pageInfo.page + 1)">下一页</button></div></div>
    </section>

    <Transition name="toast"><div v-if="toastMessage" class="toast-message" role="status">✦ {{ toastMessage }}</div></Transition>

    <div v-if="askItem" class="ask-backdrop" role="presentation" @click.self="closeAsk" @keydown.esc.stop.prevent="closeAsk">
      <section ref="askDialog" class="ask-dialog" role="dialog" aria-modal="true" aria-labelledby="ask-title" tabindex="-1" @keydown="cycleAskFocus">
        <header class="ask-header"><div><span class="ask-kicker">资料问答</span><h2 id="ask-title">向文件提问</h2><p :title="askItem.original_name">{{ askItem.original_name }}</p></div><button type="button" class="modal-close" aria-label="关闭问答" @click="closeAsk">×</button></header>
        <div class="ask-body">
          <p class="ask-intro">只根据这份文件回答。支持 UTF-8 的 TXT / Markdown，回答中的 [数字] 对应文件段落。</p>
          <form class="ask-form" @submit.prevent="submitAsk">
            <label for="ask-question">你的问题</label>
            <textarea id="ask-question" v-model="askQuestion" maxlength="500" rows="3" placeholder="例如：这份资料的主要结论是什么？" :disabled="askBusy" />
            <div class="ask-form-footer"><span>{{ askQuestion.length }} / 500</span><button class="primary-action" type="submit" :disabled="askBusy || !askQuestion.trim() || askItem.size > 1 << 20">{{ askBusy ? '正在阅读…' : '发送问题 →' }}</button></div>
          </form>
          <p v-if="askItem.size > 1 << 20" class="ask-hint" role="alert">此文件超过 1 MiB，暂不支持问答。</p>
          <p v-if="askError" class="ask-error" role="alert">{{ askError }}</p>
          <div v-if="askBusy" class="ask-working" role="status"><span class="loading-orbit" />正在从文件中寻找回答…</div>
          <section v-else-if="askAnswer" class="ask-result" aria-label="文件回答"><span class="ask-result-label">基于文件的回答</span><p>{{ askAnswer }}</p><small>引用编号由模型生成，请对照原文件核查重要信息。</small></section>
        </div>
      </section>
    </div>

    <div v-if="previewItem" class="preview-backdrop" role="presentation" @click.self="closePreview" @keydown.esc.stop.prevent="closePreview">
      <section class="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <header class="preview-header"><div><span class="preview-kicker">文件预览</span><h2 id="preview-title">{{ previewItem.original_name }}</h2></div><button type="button" class="modal-close" aria-label="关闭预览" @click="closePreview">×</button></header>
        <div v-if="previewLoading" class="preview-state" role="status">正在读取文件…</div>
        <div v-else-if="previewError" class="preview-state preview-error" role="alert"><p>{{ previewError }}</p><button class="secondary-action" type="button" @click="closePreview">关闭</button></div>
        <template v-else>
          <p v-if="previewTruncated" class="preview-notice">文本较长，仅显示前 2 MiB。</p>
          <img v-if="previewKind === 'image' && previewURL" class="preview-image" :src="previewURL" :alt="previewItem.original_name" />
          <iframe v-else-if="previewKind === 'pdf' && previewURL" class="preview-pdf" :src="previewURL" :title="`预览 ${previewItem.original_name}`" />
          <pre v-else-if="previewKind === 'text'" class="preview-text">{{ previewText }}</pre>
        </template>
      </section>
    </div>

    <div v-if="dialog" class="modal-backdrop" role="presentation" @click.self="closeDialog" @keydown.esc.stop.prevent="closeDialog">
      <section ref="modalElement" class="action-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1" @keydown="cycleDialogFocus">
        <button class="modal-close" type="button" aria-label="关闭对话框" @click="closeDialog">×</button>
        <h2 id="dialog-title">{{ dialog.action === 'create' ? '创建文件夹' : dialog.action === 'rename' ? '重命名' : '移动到' }}</h2>
        <form @submit.prevent="confirmDialog">
          <label v-if="dialog.action !== 'move'" class="field"><span>{{ dialog.action === 'create' ? '文件夹名称' : '新名称' }}</span><input v-model="dialogValue" maxlength="255" required :placeholder="dialog.action === 'create' ? '例如：旅行照片' : '输入新名称'" /></label>
          <label v-else class="field"><span>目标文件夹</span><select v-model.number="targetID"><option v-for="target in folderTargets" :key="target.id" :value="target.id">{{ target.label }}</option></select></label>
          <p v-if="errorMessage" class="form-message error" role="alert">{{ errorMessage }}</p>
          <div class="modal-actions"><button class="secondary-action" type="button" @click="closeDialog">取消</button><button class="primary-action" type="submit" :disabled="busy">{{ busy ? '处理中…' : '确认' }}</button></div>
        </form>
      </section>
    </div>
  </div>
</template>
