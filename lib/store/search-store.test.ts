import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchResultData } from '@/lib/api/search'
import type { Song, SourceType } from '@/lib/types/music'

const { search } = vi.hoisted(() => ({ search: vi.fn() }))

vi.mock('@/lib/api/search', () => ({ search }))

const { useSearchStore } = await import('./search-store')

function makeResult(source: SourceType, name: string): SearchResultData {
  return {
    list: name ? [{ uid: `${source}-${name}`, name, source } as Song] : [],
    total: name ? 1 : 0,
    page: 1,
    allPage: name ? 1 : 0,
    limit: 30,
    source,
    hasMore: false,
    nextPage: null,
  }
}

describe('全部渠道搜索', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSearchStore.getState().reset()
  })

  it('先显示已返回的歌曲，后续结果仍按渠道顺序排列', async () => {
    const pending = new Map<SourceType, (value: SearchResultData) => void>()
    search.mockImplementation((source: SourceType) => new Promise(resolve => {
      pending.set(source, resolve)
    }))

    const run = useSearchStore.getState().run('测试', 'all')
    pending.get('kw')!(makeResult('kw', '酷我歌曲'))
    await vi.waitFor(() => expect(useSearchStore.getState().results.map(s => s.name)).toEqual(['酷我歌曲']))
    expect(useSearchStore.getState().loading).toBe(false)
    expect(useSearchStore.getState().pendingSources).toBe(4)

    pending.get('tx')!(makeResult('tx', 'QQ歌曲'))
    await vi.waitFor(() => expect(useSearchStore.getState().results.map(s => s.name)).toEqual(['QQ歌曲', '酷我歌曲']))
    pending.get('wy')!(makeResult('wy', ''))
    pending.get('kg')!(makeResult('kg', ''))
    pending.get('mg')!(makeResult('mg', ''))
    await run
    expect(useSearchStore.getState().pendingSources).toBe(0)
  })

  it('重置后忽略旧搜索的返回值', async () => {
    let resolveSearch!: (value: SearchResultData) => void
    search.mockImplementation(() => new Promise(resolve => { resolveSearch = resolve }))

    const run = useSearchStore.getState().run('旧关键词', 'kw')
    useSearchStore.getState().reset()
    resolveSearch(makeResult('kw', '旧结果'))
    await run

    expect(useSearchStore.getState().results).toEqual([])
    expect(useSearchStore.getState().lastKeyword).toBe('')
  })

  it('全部渠道失败时仍显示服务错误', async () => {
    search.mockRejectedValue(new Error('请求超时'))

    await useSearchStore.getState().run('测试', 'all')

    expect(useSearchStore.getState()).toMatchObject({
      results: [],
      loading: false,
      pendingSources: 0,
      error: '请求超时',
    })
  })
})

describe('单平台分页及聚合边界', () => {
  beforeEach(() => { search.mockReset(); useSearchStore.getState().reset() })

  function page(name: string, nextPage: number | null = 2, limit = 20): SearchResultData {
    return { ...makeResult('wy', name), nextPage, hasMore: nextPage !== null, limit }
  }

  it('使用有效页大小追加结果，重复歌曲去重，结束后不再请求', async () => {
    search.mockResolvedValueOnce(page('第一首'))
      .mockResolvedValueOnce({ ...page('第二首', null), list: [...page('第一首').list, ...page('第二首').list] })
    await useSearchStore.getState().run('测试', 'wy')
    await useSearchStore.getState().loadMore()
    expect(search).toHaveBeenLastCalledWith('wy', '测试', 2, 20, expect.any(AbortSignal))
    expect(useSearchStore.getState().results.map(song => song.name)).toEqual(['第一首', '第二首'])
    await useSearchStore.getState().loadMore()
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('分页失败保留结果和游标，重试同一页', async () => {
    search.mockResolvedValueOnce(page('第一首')).mockRejectedValueOnce(new Error('超时')).mockResolvedValueOnce(page('第二首', null))
    await useSearchStore.getState().run('测试', 'wy')
    await useSearchStore.getState().loadMore()
    expect(useSearchStore.getState()).toMatchObject({ nextPage: 2, loadMoreError: '超时', loadingMore: false })
    expect(useSearchStore.getState().results).toHaveLength(1)
    await useSearchStore.getState().loadMore()
    expect(search.mock.calls.slice(1).map(call => call[2])).toEqual([2, 2])
    expect(useSearchStore.getState().loadMoreError).toBeNull()
  })

  it('并发加载合并，切换搜索后旧页不能混入', async () => {
    let resolvePage!: (value: SearchResultData) => void
    search.mockResolvedValueOnce(page('第一页')).mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve }))
      .mockResolvedValueOnce(makeResult('kw', '新搜索'))
    await useSearchStore.getState().run('旧关键词', 'wy')
    const pending = useSearchStore.getState().loadMore()
    await useSearchStore.getState().loadMore()
    expect(search).toHaveBeenCalledTimes(2)
    const signal = search.mock.calls[1][4] as AbortSignal
    await useSearchStore.getState().run('新关键词', 'kw')
    expect(signal.aborted).toBe(true)
    resolvePage(page('旧第二页', null))
    await pending
    expect(useSearchStore.getState().results.map(song => song.name)).toEqual(['新搜索'])
  })

  it('重复页报错并保留重试游标，不假装已结束', async () => {
    search.mockResolvedValueOnce(page('第一首')).mockResolvedValueOnce(page('第一首', null))
    await useSearchStore.getState().run('测试', 'wy')
    await useSearchStore.getState().loadMore()
    expect(useSearchStore.getState()).toMatchObject({ nextPage: 2, loadMoreError: '平台返回了异常分页，请重试' })
  })

  it('聚合模式永远不加载第二页，失败平台可单独重试', async () => {
    search.mockImplementation(async (source: SourceType) => {
      if (source === 'wy') throw new Error('超时')
      return { ...makeResult(source, source), hasMore: true, nextPage: 2 }
    })
    await useSearchStore.getState().run('测试', 'all')
    expect(useSearchStore.getState().results).toHaveLength(4)
    expect(useSearchStore.getState().sourceErrors).toEqual({ wy: '超时' })
    await useSearchStore.getState().loadMore()
    expect(search).toHaveBeenCalledTimes(5)
    search.mockResolvedValueOnce(page('网易'))
    await useSearchStore.getState().retrySource('wy')
    expect(search).toHaveBeenCalledTimes(6)
    expect(useSearchStore.getState()).toMatchObject({ sourceErrors: {}, nextPage: null })
    expect(useSearchStore.getState().results).toHaveLength(5)
  })
})
