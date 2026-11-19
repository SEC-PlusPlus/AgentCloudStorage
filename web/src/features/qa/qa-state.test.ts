// Task 12 RED-first：canAsk 边界（旧 adbcfba:308 正则 + :350 1MiB 守卫，判定改用 FileRow.sizeBytes——
// 勿走 preview-kind 的 TEXT 集：log/csv 属预览不属问答，T10 修复轮 Minor-5 钉死）与
// appendTurn 纯函数语义（失败轮重试不重复计入用户气泡）。
import { describe, expect, it } from 'vitest'
import { appendTurn, canAsk, QA_MAX_ASK_BYTES, QA_OVERSIZE_HINT_COPY, QA_TYPE_UNSUPPORTED_COPY } from './qa-state'
import type { QaTurn } from './qa-state'
import type { FileRow } from '@/features/files/useFileRows'

const ONE_MIB = 1 << 20

function fileRow(name: string, sizeBytes: number): FileRow {
  return { kind: 'file', id: 1, name, folderId: 0, sizeBytes, sizeText: '', dateText: '', contentType: 'text/plain' }
}

describe('canAsk——旧 canAsk 正则 ∧ 旧发送守卫的合并移植', () => {
  it('txt/md 且 ≤1 MiB → ok', () => {
    expect(canAsk(fileRow('notes.txt', 1024))).toEqual({ ok: true })
    expect(canAsk(fileRow('readme.md', ONE_MIB)).ok).toBe(true) // 边界：恰等 1 MiB 放行（旧 `>` 等号原样）
  })

  it('1 MiB ±1 字节：+1 拒（reason=旧超限文案逐字），-1 放行', () => {
    expect(QA_MAX_ASK_BYTES).toBe(ONE_MIB)
    const over = canAsk(fileRow('notes.txt', ONE_MIB + 1))
    expect(over.ok).toBe(false)
    expect(over.reason).toBe(QA_OVERSIZE_HINT_COPY)
    expect(canAsk(fileRow('notes.txt', ONE_MIB - 1)).ok).toBe(true)
  })

  it('扩展名大小写混排命中（正则 /i 逐字照搬旧 :308）', () => {
    expect(canAsk(fileRow('REPORT.MD', 8)).ok).toBe(true)
    expect(canAsk(fileRow('summary.TxT', 8)).ok).toBe(true)
  })

  it('非 text 问答集拒绝——log/csv 属预览不属问答（T10 Minor-5 钉死：勿复用 TEXT_PREVIEW_KINDS）', () => {
    expect(canAsk(fileRow('data.log', 8)).ok).toBe(false)
    expect(canAsk(fileRow('table.csv', 8)).ok).toBe(false)
    expect(canAsk(fileRow('archive.zip', 8)).ok).toBe(false)
    expect(canAsk(fileRow('readme', 8)).ok).toBe(false) // 无点文件名
  })

  it('文件夹行恒拒', () => {
    const folder: FileRow = { kind: 'folder', id: 2, name: 'docs.md', sizeText: null, dateText: '' }
    expect(canAsk(folder).ok).toBe(false)
    expect(canAsk(folder).reason).toBe(QA_TYPE_UNSUPPORTED_COPY)
  })

  it('类型与超限同时命中 → 先报类型（reason 稳定）', () => {
    expect(canAsk(fileRow('huge.zip', ONE_MIB + 1)).reason).toBe(QA_TYPE_UNSUPPORTED_COPY)
  })
})

describe('appendTurn——纯函数 + 失败轮重试语义', () => {
  it('普通追加不可变（不改动入参数组）', () => {
    const base: QaTurn[] = [{ role: 'user', text: '结论是什么？' }]
    const next = appendTurn(base, { role: 'assistant', text: '主要结论是 A。' })
    expect(base).toHaveLength(1)
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual({ role: 'assistant', text: '主要结论是 A。' })
  })

  it('失败轮重试：尾部 failed assistant 被新 assistant 轮替换（不留双气泡，failed 标记清除）', () => {
    const failed: QaTurn[] = [
      { role: 'user', text: 'Q' },
      { role: 'assistant', text: '问答失败。请确认文件为较短的 UTF-8 文本，或稍后重试。', failed: true },
    ]
    const after = appendTurn(failed, { role: 'assistant', text: 'A' })
    expect(after).toEqual([
      { role: 'user', text: 'Q' },
      { role: 'assistant', text: 'A' },
    ])
  })

  it('重试再失败：failed 轮被最新 failed 轮替换（annotate 最新错误，不堆叠）', () => {
    const failed: QaTurn[] = [
      { role: 'user', text: 'Q' },
      { role: 'assistant', text: '旧错误', failed: true },
    ]
    const after = appendTurn(failed, { role: 'assistant', text: '新错误', failed: true })
    expect(after).toHaveLength(2)
    expect(after[1]).toEqual({ role: 'assistant', text: '新错误', failed: true })
  })

  it('重试不重复计入用户轮：同文本连续 user 追加为 no-op（同引用返回）', () => {
    const list: QaTurn[] = [{ role: 'user', text: 'Q' }]
    expect(appendTurn(list, { role: 'user', text: 'Q' })).toBe(list)
  })

  it('不同用户问题正常追加；隔轮同文本不算重复', () => {
    const two = appendTurn([{ role: 'user', text: 'Q' }], { role: 'user', text: 'Q2' })
    expect(two).toHaveLength(2)
    const roundTrip = appendTurn(
      appendTurn(two, { role: 'assistant', text: 'A2' }),
      { role: 'user', text: 'Q' },
    )
    expect(roundTrip).toHaveLength(4) // 尾部非 user → 追加（历史问答可重复同问，属新对话轮）
  })

  it('failed 后跟新提问：failed 气泡留在原位不吞掉（替换仅针对重试结果）', () => {
    const after = appendTurn(
      [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: '失败', failed: true },
      ],
      { role: 'user', text: '新问题' },
    )
    expect(after).toHaveLength(3)
  })
})
