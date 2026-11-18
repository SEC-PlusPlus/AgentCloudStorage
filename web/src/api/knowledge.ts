// 移植自旧 Vue 版 web/src/api/knowledge.ts（历史提交 adbcfba）：auth.token.value → getToken()。
import { request } from '@/api/client'
import { getToken } from '@/stores/auth'

export interface AskFileResponse {
  answer: string
}

export function askFile(fileId: number, question: string, signal?: AbortSignal) {
  return request<AskFileResponse>('/api/v1/knowledge/ask', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId, question }),
    signal,
  }, getToken())
}
