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
  error: null,
  reqId: 0,

  setKeyword: kw => set({ keyword: kw }),

  setSource: s => set({ source: s }),

  run: async (kw, source) => {
    const trimmed = kw.trim()
    if (!trimmed) {
      set({ results: [], loading: false, error: null, lastKeyword: '', lastSource: source })
      return
    }
    const reqId = get().reqId + 1
    set({ loading: true, error: null, reqId })

    try {
      const sources = source === 'all' ? ALL_SOURCES : [source]
      const responses = await Promise.all(
        sources.map(s =>
          search(s, trimmed, 1, 30)
            .then(r => r.list)
            .catch(() => [] as Song[])
        )
      )
      // 过期请求丢弃
      if (reqId !== get().reqId) return
      set({
        results: responses.flat(),
        loading: false,
        error: null,
        lastKeyword: trimmed,
        lastSource: source,
      })
    } catch (e) {
      if (reqId !== get().reqId) return
      set({
        loading: false,
        error: e instanceof Error ? e.message : '搜索失败',
      })
    }
  },

  reset: () =>
    set({
      keyword: '',
      source: 'all',
      lastKeyword: '',
      lastSource: 'all',
      results: [],
      loading: false,
      error: null,
      reqId: 0,
    }),
}))
