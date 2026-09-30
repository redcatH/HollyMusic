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
