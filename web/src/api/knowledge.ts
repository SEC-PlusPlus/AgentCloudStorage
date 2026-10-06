import { request } from './client'
import { auth } from '../stores/auth'

export interface AskFileResponse { answer: string }

export function askFile(fileId: number, question: string, signal?: AbortSignal) {
  return request<AskFileResponse>('/api/v1/knowledge/ask', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId, question }),
    signal,
  }, auth.token.value)
}
