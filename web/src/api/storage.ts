import { ApiError, request } from './client'
import { auth } from '../stores/auth'

export interface PageInfo { page: number; page_size: number; total: number }
export interface FileItem {
  id: number; folder_id: number; original_name: string; size: number
  content_type: string; created_at: string; deleted_at?: string | null
}
export interface FolderItem {
  id: number; parent_id: number; name: string; created_at: string; updated_at: string
}
export interface PageResult<T> { items: T[]; pagination: PageInfo }
export interface MultipartUploadSession { id: string; part_size: number; expires_at: string }
export interface MultipartUploadProgress {
  id: string; status: number; size: number; part_size: number; total_parts: number
  uploaded_parts: number[]; expires_at: string
}

export const listFiles = (folderId: number, page = 1) =>
  request<PageResult<FileItem>>(`/api/v1/files?folder_id=${folderId}&page=${page}&page_size=20`, {}, token())
export const listFolders = (parentId: number) =>
  request<{ items: FolderItem[] }>(`/api/v1/folders?parent_id=${parentId}`, {}, token())
export const listTrash = (page = 1) =>
  request<PageResult<FileItem>>(`/api/v1/trash?page=${page}&page_size=20`, {}, token())
export const searchFiles = (keyword: string, page = 1) =>
  request<PageResult<FileItem>>(`/api/v1/files/search?q=${encodeURIComponent(keyword)}&page=${page}&page_size=20`, {}, token())
export const getStorageUsage = () => request<{ used_bytes: number }>('/api/v1/storage/usage', {}, token())

export async function uploadFile(file: File, folderId: number) {
  const form = new FormData()
  form.append('file', file)
  form.append('folder_id', String(folderId))
  return request<FileItem>('/api/v1/files', { method: 'POST', body: form }, token())
}
export const startMultipartUpload = (file: File, folderId: number) =>
  request<MultipartUploadSession>('/api/v1/uploads', {
    method: 'POST',
    body: JSON.stringify({ folder_id: folderId, original_name: file.name, content_type: file.type || 'application/octet-stream', size: file.size }),
  }, token())
export const getMultipartUploadProgress = (id: string) =>
  request<MultipartUploadProgress>(`/api/v1/uploads/${encodeURIComponent(id)}`, {}, token())
export const uploadMultipartPart = (id: string, number: number, part: Blob, signal: AbortSignal) =>
  request<{ part_number: number; size: number }>(`/api/v1/uploads/${encodeURIComponent(id)}/parts/${number}`, {
    method: 'PUT', body: part, signal, headers: { 'Content-Type': 'application/octet-stream' },
  }, token())
export const completeMultipartUpload = (id: string) =>
  request<FileItem>(`/api/v1/uploads/${encodeURIComponent(id)}/complete`, { method: 'POST' }, token())
export const cancelMultipartUpload = (id: string) =>
  request<void>(`/api/v1/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }, token())
export const createFolder = (name: string, parentId: number) =>
  request<FolderItem>('/api/v1/folders', { method: 'POST', body: JSON.stringify({ name, parent_id: parentId }) }, token())
export const renameFile = (id: number, name: string) =>
  request<void>(`/api/v1/files/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }, token())
export const renameFolder = (id: number, name: string) =>
  request<void>(`/api/v1/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }, token())
export const moveFile = (id: number, folderId: number) =>
  request<void>(`/api/v1/files/${id}/move`, { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) }, token())
export const moveFolder = (id: number, parentId: number) =>
  request<void>(`/api/v1/folders/${id}/move`, { method: 'PATCH', body: JSON.stringify({ parent_id: parentId }) }, token())
export const trashFile = (id: number) => request<void>(`/api/v1/files/${id}`, { method: 'DELETE' }, token())
export const deleteFolder = (id: number) => request<void>(`/api/v1/folders/${id}`, { method: 'DELETE' }, token())
export const restoreFile = (id: number) => request<void>(`/api/v1/files/${id}/restore`, { method: 'POST' }, token())
export const permanentlyDelete = (id: number) => request<void>(`/api/v1/trash/${id}`, { method: 'DELETE' }, token())

async function fileContentResponse(item: FileItem): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`/api/v1/files/${item.id}/content`, { headers: { Authorization: `Bearer ${token()}` } })
  } catch {
    throw new ApiError('无法连接到服务，请确认 Go 后端已启动。', 0)
  }
  if (!response.ok) {
    if (response.status === 401) {
      auth.clear()
      window.dispatchEvent(new Event('acs:unauthorized'))
    }
    throw new ApiError(response.status === 404 ? '文件不存在或已被删除。' : '读取文件失败，请稍后重试。', response.status)
  }
  return response
}

export async function fetchFileContent(item: FileItem, contentType?: string): Promise<Blob> {
  const response = await fileContentResponse(item)
  const blob = await response.blob()
  return contentType ? new Blob([blob], { type: contentType }) : blob
}

export async function fetchTextPreview(item: FileItem, maxBytes: number): Promise<{ blob: Blob; truncated: boolean }> {
  const response = await fileContentResponse(item)
  const hasDeclaredSize = response.headers.has('Content-Length')
  const declaredSize = Number(response.headers.get('Content-Length'))
  if (!response.body) {
    const blob = await response.blob()
    return { blob: blob.slice(0, maxBytes, 'text/plain'), truncated: blob.size > maxBytes }
  }
  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let readBytes = 0
  let ended = false
  try {
    while (readBytes < maxBytes) {
      const result = await reader.read()
      if (result.done) { ended = true; break }
      const remaining = maxBytes - readBytes
      const chunk = result.value.byteLength > remaining ? result.value.slice(0, remaining) : result.value
      chunks.push(Uint8Array.from(chunk).buffer as ArrayBuffer)
      readBytes += chunk.byteLength
      if (chunk.byteLength < result.value.byteLength) break
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => undefined)
  }
  return {
    blob: new Blob(chunks, { type: 'text/plain' }),
    truncated: hasDeclaredSize ? declaredSize > maxBytes : !ended && readBytes >= maxBytes,
  }
}

export async function downloadFile(item: FileItem) {
  const blob = await fetchFileContent(item)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = item.original_name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function token() { return auth.token.value }
