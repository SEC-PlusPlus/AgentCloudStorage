<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { ApiError } from '../api/client'
import { permanentlyDelete, restoreFile, listTrash } from '../api/storage'
import type { FileItem, PageInfo } from '../api/storage'

const items = ref<FileItem[]>([])
const page = ref<PageInfo>({ page: 1, page_size: 20, total: 0 })
const loading = ref(true)
const busyID = ref<number | null>(null)
const error = ref('')
const notice = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await listTrash(page.value.page)
    items.value = result.items
    page.value = result.pagination
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : '暂时无法读取回收站。'
  } finally { loading.value = false }
}
onMounted(() => { void load() })
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024, unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}
function date(value?: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) : '—'
}
async function restore(item: FileItem) {
  busyID.value = item.id
  error.value = ''
  try {
    await restoreFile(item.id)
    notice.value = `“${item.original_name}”已恢复。`
    await load()
  } catch (cause) { error.value = cause instanceof ApiError ? cause.message : '恢复失败，请重试。' }
  finally { busyID.value = null }
}
async function destroy(item: FileItem) {
  try {
    await ElMessageBox.confirm(`永久删除“${item.original_name}”？该操作无法撤销。`, '永久删除文件', { confirmButtonText: '永久删除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'confirm-danger' })
  } catch { return }
  busyID.value = item.id
  error.value = ''
  try {
    await permanentlyDelete(item.id)
    notice.value = `“${item.original_name}”已永久删除。`
    await load()
  } catch (cause) { error.value = cause instanceof ApiError ? cause.message : '永久删除失败，请重试。' }
  finally { busyID.value = null }
}
function changePage(next: number) { page.value.page = next; void load() }
</script>

<template>
  <div class="shell-content workbench trash-page">
    <div class="workbench-heading"><div><div class="workbench-title-row"><h1>回收站</h1><span class="item-count">{{ page.total }} 个项目</span></div><p class="workbench-subtitle">这里的文件可以恢复，或永久删除。</p></div></div>
    <el-alert v-if="error" class="inline-error" :title="error" type="error" show-icon closable role="alert" @close="error = ''" />
    <el-alert v-if="notice" class="directory-hint" :title="notice" type="success" show-icon closable @close="notice = ''" />
    <div v-if="loading" class="loading-state"><span class="loading-orbit" />正在读取回收站…</div>
    <div v-else-if="!items.length" class="empty-workspace file-empty"><el-empty description="回收站是空的"><p>被移入回收站的文件会显示在这里。</p></el-empty></div>
    <section v-else class="file-table-wrap" aria-label="回收站文件列表">
      <div class="file-table-head trash-table-head"><span>名称</span><span>大小</span><span>删除日期</span><span class="actions-heading">操作</span></div>
      <div v-for="item in items" :key="item.id" class="file-row trash-row"><div class="entry-name"><span class="entry-glyph trash-glyph"><el-icon><Delete /></el-icon></span><span class="entry-text"><b>{{ item.original_name }}</b><small>{{ item.content_type || '未知类型' }}</small></span></div><span class="file-meta">{{ size(item.size) }}</span><span class="file-meta">{{ date(item.deleted_at) }}</span><div class="row-actions trash-actions"><el-button text :loading="busyID === item.id" @click="restore(item)">恢复</el-button><el-button text type="danger" :disabled="busyID === item.id" @click="destroy(item)">永久删除</el-button></div></div>
      <div v-if="page.total > page.page_size" class="pagination"><span>共 {{ page.total }} 个项目</span><el-pagination :current-page="page.page" :page-size="page.page_size" :total="page.total" layout="prev, pager, next" background @current-change="changePage" /></div>
    </section>
    <div class="trash-warning"><span>!</span> 永久删除后无法恢复。恢复的文件会回到原目录；如果原目录不存在，服务端可能无法恢复。</div>
  </div>
</template>
