import { create } from 'zustand'
import { search } from '@/lib/api/search'
import type { Song, SourceType } from '@/lib/types/music'

const ALL_SOURCES: SourceType[] = ['tx', 'wy', 'kw', 'kg', 'mg']
const requests = new Set<AbortController>()

function cancelRequests() {
  for (const controller of requests) controller.abort()
  requests.clear()
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return !message || /Failed to execute|Network Error|fetch|JSON|ECONN/i.test(message)
    ? '网络异常或服务不可用，请稍后重试' : message
}

function uniqueSongs(songs: Song[]): Song[] {
  const seen = new Set<string>()
  return songs.filter(song => {
    if (seen.has(song.uid)) return false
    seen.add(song.uid)
    return true
  })
}

interface SearchStore {
  keyword: string
  source: SourceType | 'all'
  lastKeyword: string
  lastSource: SourceType | 'all'
  results: Song[]
  loading: boolean
  pendingSources: number
  sourceErrors: Partial<Record<SourceType, string>>
  error: string | null
  reqId: number
  nextPage: number | null
  pageSize: number
  pageKeys: string[]
  loadingMore: boolean
  loadMoreError: string | null
  setKeyword: (keyword: string) => void
  setSource: (source: SourceType | 'all') => void
  run: (keyword: string, source: SourceType | 'all') => Promise<void>
  loadMore: () => Promise<void>
  retrySource: (source: SourceType) => Promise<void>
  reset: () => void
}

const initialState = {
  keyword: '', source: 'all' as const, lastKeyword: '', lastSource: 'all' as const,
  results: [] as Song[], loading: false, pendingSources: 0, sourceErrors: {}, error: null,
  nextPage: null, pageSize: 30, pageKeys: [] as string[], loadingMore: false, loadMoreError: null,
}

/** 一个 Web 搜索会话：聚合仅首批，单平台独立翻页；导航离开时保留当前会话。 */
export const useSearchStore = create<SearchStore>((set, get) => {
  async function firstPage(source: SourceType, keyword: string, reqId: number) {
    const controller = new AbortController()
    requests.add(controller)
    try {
      const response = await search(source, keyword, 1, 30, controller.signal)
      if (get().reqId !== reqId) return
      const state = get()
      const results = uniqueSongs([...state.results.filter(song => song.source !== source), ...response.list])
      set({
        results: ALL_SOURCES.flatMap(s => results.filter(song => song.source === s)),
        ...(state.lastSource !== 'all' ? {
          nextPage: response.nextPage ?? null, pageSize: response.limit,
          pageKeys: [response.list.map(song => song.uid).join(',')],
        } : {}),
      })
    } catch (error) {
      if (get().reqId !== reqId) return
      set({ sourceErrors: { ...get().sourceErrors, [source]: friendlyError(error) } })
    } finally {
      requests.delete(controller)
      if (get().reqId === reqId) {
        const state = get()
        const pendingSources = state.pendingSources - 1
        const allFailed = Object.keys(state.sourceErrors).length === (state.lastSource === 'all' ? ALL_SOURCES.length : 1)
        set({ pendingSources, loading: state.results.length === 0 && pendingSources > 0,
          error: pendingSources === 0 && allFailed ? Object.values(state.sourceErrors)[0] ?? null : null })
      }
    }
  }

  return {
    ...initialState, reqId: 0,
    setKeyword: keyword => set({ keyword }),
    setSource: source => set({ source }),
    run: async (keyword, source) => {
      cancelRequests()
      const trimmed = keyword.trim()
      const reqId = get().reqId + 1
      const sources = source === 'all' ? ALL_SOURCES : [source]
      set({ ...initialState, keyword: get().keyword, source: get().source, lastKeyword: trimmed,
        lastSource: source, reqId, loading: Boolean(trimmed), pendingSources: trimmed ? sources.length : 0 })
      if (trimmed) await Promise.all(sources.map(s => firstPage(s, trimmed, reqId)))
    },
    retrySource: async source => {
      const state = get()
      if (!state.sourceErrors[source]) return
      const sourceErrors = { ...state.sourceErrors }
      delete sourceErrors[source]
      set({ sourceErrors, error: null, pendingSources: state.pendingSources + 1, loading: state.results.length === 0 })
      await firstPage(source, state.lastKeyword, state.reqId)
    },
    loadMore: async () => {
      const state = get()
      if (state.lastSource === 'all' || state.nextPage === null || state.loadingMore || state.pendingSources > 0) return
      const { reqId, nextPage, pageSize, lastKeyword, lastSource } = state
      const controller = new AbortController()
      requests.add(controller)
      set({ loadingMore: true, loadMoreError: null })
      try {
        const response = await search(lastSource, lastKeyword, nextPage, pageSize, controller.signal)
        if (get().reqId !== reqId) return
        const pageKey = response.list.map(song => song.uid).join(',')
        if ((response.list.length > 0 && get().pageKeys.includes(pageKey))
          || (response.nextPage !== null && response.nextPage <= nextPage)
          || response.limit !== pageSize || (response.hasMore && response.list.length === 0)) {
          throw new Error('平台返回了异常分页，请重试')
        }
        set({ results: uniqueSongs([...get().results, ...response.list]), nextPage: response.nextPage,
          pageKeys: [...get().pageKeys, pageKey] })
      } catch (error) {
        if (get().reqId === reqId) set({ loadMoreError: friendlyError(error) })
      } finally {
        requests.delete(controller)
        if (get().reqId === reqId) set({ loadingMore: false })
      }
    },
    reset: () => { cancelRequests(); set({ ...initialState, reqId: get().reqId + 1 }) },
  }
})
