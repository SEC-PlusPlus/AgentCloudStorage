// Task 9 失效键纯函数测试（brief Step 1 RED 先行；Review Focus #4 钉死）。
// 契约（brief Interfaces 原文）：
//   computeInvalidations({ type:'create-folder'|'rename'|'move'|'trash'|'restore'|'perm-delete';
//                          fromFolder?: number; toFolder?: number }, currentFolder): QueryKey[]
//   —— move 必须同时含【源与目标目录 key + navTrail + usage】；trash 含 usage；create-folder 含 folders+files key。
// 键形态与消费方对齐：['folders',id] / ['files',id]（page 后缀天然前缀匹配多页缓存）/
// ['search'] ['trash'] ['navTrail'] ['usage'] 为族级前缀（rename/move/trash 影响任意搜索词、回收站页、
// 面包屑缓存；action 形状不带关键词/链 id，族失效是唯一可表达且正确的粒度）。
import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { applyInvalidations, computeInvalidations, mutationErrorMessage } from './actions'
import { ApiError } from '@/api/client'
import type { QueryKey } from '@tanstack/react-query'

const hasKey = (keys: QueryKey[], key: QueryKey): boolean =>
  keys.some((candidate) => JSON.stringify(candidate) === JSON.stringify(key))

describe('computeInvalidations：brief Step 1 三钉', () => {
  it('move：源目录 + 目标目录（folders/files 双键）+ navTrail + usage 同时在场（Review Focus #4）', () => {
    const keys = computeInvalidations({ type: 'move', fromFolder: 3, toFolder: 7 }, 3)
    expect(hasKey(keys, ['folders', 3])).toBe(true)
    expect(hasKey(keys, ['files', 3])).toBe(true)
    expect(hasKey(keys, ['folders', 7])).toBe(true)
    expect(hasKey(keys, ['files', 7])).toBe(true)
    expect(hasKey(keys, ['navTrail'])).toBe(true)
    expect(hasKey(keys, ['usage'])).toBe(true)
  })

  it('trash：含 usage', () => {
    expect(hasKey(computeInvalidations({ type: 'trash', fromFolder: 4 }, 4), ['usage'])).toBe(true)
  })

  it('create-folder：含 folders + files 键', () => {
    const keys = computeInvalidations({ type: 'create-folder' }, 0)
    expect(hasKey(keys, ['folders', 0])).toBe(true)
    expect(hasKey(keys, ['files', 0])).toBe(true)
  })
})

describe('computeInvalidations：六动作全表（精确等于，钉死顺序与粒度）', () => {
  it('create-folder @5（fromFolder 省略 → currentFolder 兜底）', () => {
    expect(computeInvalidations({ type: 'create-folder' }, 5)).toEqual([['folders', 5], ['files', 5]])
  })

  it('rename：当前目录双列表 + 搜索族 + 面包屑族（文件夹改名会污染各级链缓存）', () => {
    expect(computeInvalidations({ type: 'rename', fromFolder: 2 }, 9)).toEqual([
      ['folders', 2],
      ['files', 2],
      ['search'],
      ['navTrail'],
    ])
  })

  it('move：完整精确序', () => {
    expect(computeInvalidations({ type: 'move', fromFolder: 3, toFolder: 7 }, 3)).toEqual([
      ['folders', 3],
      ['files', 3],
      ['folders', 7],
      ['files', 7],
      ['search'],
      ['navTrail'],
      ['usage'],
    ])
  })

  it('move 源=目标（同父“移动”合法请求，后端可能 409）：键去重不重复失效', () => {
    expect(computeInvalidations({ type: 'move', fromFolder: 6, toFolder: 6 }, 6)).toEqual([
      ['folders', 6],
      ['files', 6],
      ['search'],
      ['navTrail'],
      ['usage'],
    ])
  })

  it('trash：目录双列表（deleteFolder 走同型）+ 搜索 + 回收站 + usage，精确等于', () => {
    expect(computeInvalidations({ type: 'trash', fromFolder: 4 }, 4)).toEqual([
      ['folders', 4],
      ['files', 4],
      ['search'],
      ['trash'],
      ['usage'],
    ])
  })

  it('restore：文件回原目录（toFolder=归属目录，files 键即可，folders 列表未变）+ 搜索 + 回收站 + usage', () => {
    expect(computeInvalidations({ type: 'restore', toFolder: 8 }, 1)).toEqual([
      ['files', 8],
      ['search'],
      ['trash'],
      ['usage'],
    ])
  })

  it('perm-delete：仅回收站 + usage（文件本就不在浏览/搜索列表）', () => {
    expect(computeInvalidations({ type: 'perm-delete' }, 1)).toEqual([['trash'], ['usage']])
  })
})

describe('applyInvalidations：键数组逐个喂给 queryClient（前缀匹配语义由 TanStack 兑现）', () => {
  it('每键一次 invalidateQueries 且透传 queryKey', () => {
    const queryClient = new QueryClient()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    applyInvalidations(queryClient, computeInvalidations({ type: 'create-folder' }, 5))
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['folders', 5] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['files', 5] })
    spy.mockRestore()
  })
})

describe('mutationErrorMessage：错误呈现统一入口（服务端中文文案直通，非 ApiError 兜底旧 apiMessage 文案）', () => {
  it('ApiError.message 原样透传（translateError 已在 client 层映射）', () => {
    expect(mutationErrorMessage(new ApiError('文件夹内仍有文件或子文件夹。', 409))).toBe('文件夹内仍有文件或子文件夹。')
  })
  it('非 ApiError → 旧 FileWorkbench apiMessage 兜底「操作失败，请稍后重试。」', () => {
    expect(mutationErrorMessage(new TypeError('boom'))).toBe('操作失败，请稍后重试。')
  })
})

