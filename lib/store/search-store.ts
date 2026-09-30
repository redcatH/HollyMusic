/**
 * 搜索状态（zustand）
 *
 * 状态放在组件外部 store：离开搜索页再回来时不会丢失数据，输入框/源/结果都保留。
 * - run(keyword, source)：发起搜索，过期请求会被丢弃（reqId 自增）
 * - setKeyword / setSource：仅更新输入态，不触发请求
 * - reset：清空（注销或切换用户时调用）
 *
 * 参考实现：lib/store/discover-store.ts
 */

import { create } from 'zustand'
import { search } from '@/lib/api/search'
import type { Song, SourceType } from '@/lib/types/music'

const ALL_SOURCES: SourceType[] = ['tx', 'wy', 'kw', 'kg', 'mg']

interface SearchStore {
  /** 当前输入框文本 */
  keyword: string
  /** 当前选择的音源 */
  source: SourceType | 'all'
  /** 最近一次成功搜索使用的关键词（用于区分"未搜索"与"搜索无结果"） */
  lastKeyword: string
  /** 最近一次搜索使用的音源 */
  lastSource: SourceType | 'all'
  /** 搜索结果 */
  results: Song[]
  loading: boolean
  pendingSources: number
  error: string | null
  /** 请求序号，自增用于丢弃过期请求 */
  reqId: number

  setKeyword: (kw: string) => void
  setSource: (s: SourceType | 'all') => void
  run: (kw: string, source: SourceType | 'all') => Promise<void>
  reset: () => void
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  keyword: '',
  source: 'all',
  lastKeyword: '',
  lastSource: 'all',
  results: [],
  loading: false,
  pendingSources: 0,
  error: null,
  reqId: 0,

  setKeyword: kw => set({ keyword: kw }),

  setSource: s => set({ source: s }),

  run: async (kw, source) => {
    const trimmed = kw.trim()
    const reqId = get().reqId + 1
    if (!trimmed) {
      set({ results: [], loading: false, pendingSources: 0, error: null, lastKeyword: '', lastSource: source, reqId })
      return
    }
    const sources = source === 'all' ? ALL_SOURCES : [source]
    const lists = new Map<SourceType, Song[]>()
    let completed = 0
    let successful = 0
    let firstError: unknown
    set({ results: [], loading: true, pendingSources: sources.length, error: null, lastKeyword: trimmed, lastSource: source, reqId })

    await Promise.all(sources.map(async s => {
      try {
        const response = await search(s, trimmed, 1, 30)
        successful++
        lists.set(s, response.list)
      } catch (error) {
        firstError ??= error
      } finally {
        completed++
        // 新搜索或重置后，不让旧请求覆盖当前结果。
        if (reqId !== get().reqId) return
        const results = sources.flatMap(src => lists.get(src) ?? [])
        const pendingSources = sources.length - completed
        if (pendingSources === 0 && successful === 0) {
          // 全部源失败时显示错误；只要有一个源成功，空结果仍表示未找到。
          const raw = firstError instanceof Error ? firstError.message : ''
          const friendly = !raw || /Failed to execute|Network Error|fetch|JSON|ECONN/i.test(raw)
            ? '网络异常或服务不可用，请稍后重试'
            : raw
          set({ results: [], loading: false, pendingSources: 0, error: friendly })
        } else {
          set({ results, loading: results.length === 0 && pendingSources > 0, pendingSources })
        }
      }
    }))
  },

  reset: () =>
    set({
      keyword: '',
      source: 'all',
      lastKeyword: '',
      lastSource: 'all',
      results: [],
      loading: false,
      pendingSources: 0,
      error: null,
      reqId: get().reqId + 1,
    }),
}))
