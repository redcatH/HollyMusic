/**
 * lib/subsonic-search.ts 单元测试
 *
 * 覆盖两个行为契约：
 * 1. songCount 参数解析（1–500，非法回默认 50）
 * 2. 空 query 分支：与 PC「发现音乐」同源走 DB 推荐白名单随机——
 *    对上游音源零请求、不走缓存；非空 query 保持原有聚合模式（每源 1 次、第 1 页、10 条）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { handleSearch, parseSongCount } from './subsonic-search'
import { getRandomMusicInfoList } from './db'
import { searchCache } from './cache-manager'
import { getSearchSources } from './search-config'

vi.mock('./db', () => ({
  upsertMusicInfo: vi.fn(async () => ({})),
  getStorageSongmidForMusicInfo: vi.fn((mi: { songmid: string }) => mi.songmid),
  getRandomMusicInfoList: vi.fn(async () => []),
}))

vi.mock('./cache-manager', () => ({
  searchCache: { get: vi.fn(() => null), set: vi.fn() },
}))

vi.mock('./cache-config', () => ({
  getSearchCacheTTL: vi.fn(() => 60),
}))

vi.mock('./search-config', () => ({
  getSearchSources: vi.fn(() => ['wy', 'kg']),
}))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// handleSearch 内部动态 import 该模块（真实实现会打音源 API，必须 mock）
vi.mock('./music-core/music-search', () => ({
  search: vi.fn(async () => ({ list: [] })),
  default: undefined,
}))

function req(query: string): NextRequest {
  return new Request(`http://localhost/rest/search3.view${query}`) as unknown as NextRequest
}

/** 构造模拟音源返回的一首歌 */
function sourceSong(name: string) {
  return {
    name,
    singer: '歌手',
    source: 'wy',
    songmid: 'id-' + name,
    interval: '03:00',
    types: [{ type: '320k' as const, size: '3.45M' }],
    _types: { '320k': { size: '3.45M' } },
  }
}

describe('parseSongCount', () => {
  it('缺失 / 非法 → 默认 50', () => {
    expect(parseSongCount(null)).toBe(50)
    expect(parseSongCount('')).toBe(50)
    expect(parseSongCount('abc')).toBe(50)
  })

  it('clamp 到 1–500', () => {
    expect(parseSongCount('0')).toBe(1)
    expect(parseSongCount('-5')).toBe(1)
    expect(parseSongCount('1000')).toBe(500)
    expect(parseSongCount('20')).toBe(20)
    expect(parseSongCount('50')).toBe(50)
  })
})

describe('handleSearch — 空 query（客户端"随便听听"预加载）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSearchSources).mockReturnValue(['wy', 'kg'])
  })

  it('走 DB 推荐白名单随机，对上游音源零请求，且不读不写缓存', async () => {
    vi.mocked(getRandomMusicInfoList).mockResolvedValue([sourceSong('歌A'), sourceSong('歌B')] as never)

    const res = await handleSearch(req('?query=&songCount=1000&f=json'))
    const body = JSON.parse(await res.text())

    expect(body['subsonic-response'].status).toBe('ok')
    expect(body['subsonic-response'].searchResult3.song).toHaveLength(2)
    // 关键契约：不打音源、不碰缓存
    const { search } = await import('./music-core/music-search')
    expect(search).not.toHaveBeenCalled()
    expect(getRandomMusicInfoList).toHaveBeenCalledWith(500, ['wy', 'kg']) // songCount=1000 → clamp 500
    expect(searchCache.get).not.toHaveBeenCalled()
    expect(searchCache.set).not.toHaveBeenCalled()
  })

  it('空白的 query（仅空格）同样走随机分支', async () => {
    vi.mocked(getRandomMusicInfoList).mockResolvedValue([] as never)
    const res = await handleSearch(req('?query=%20%20&f=json'))
    const body = JSON.parse(await res.text())
    expect(body['subsonic-response'].searchResult3.song).toEqual([])
    const { search } = await import('./music-core/music-search')
    expect(search).not.toHaveBeenCalled()
  })

  it('songCount 生效：请 1 首只向 DB 抽 1 首', async () => {
    vi.mocked(getRandomMusicInfoList).mockResolvedValue([sourceSong('歌A')] as never)
    await handleSearch(req('?query=&songCount=1&f=json'))
    expect(getRandomMusicInfoList).toHaveBeenCalledWith(1, ['wy', 'kg'])
  })
})

describe('handleSearch — 非空 query（聚合搜索，行为保持不变）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSearchSources).mockReturnValue(['wy', 'kg'])
  })

  it('上游请求模式与现状一致：每源 1 次、第 1 页、固定 10 条；结果写缓存', async () => {
    const { search } = await import('./music-core/music-search')
    vi.mocked(search).mockImplementation(async (_src: string, _q: string, page: number, limit: number) => ({
      list: Array.from({ length: limit }, (_, i) => ({ ...sourceSong('s' + page + i) })),
    }) as never)

    const res = await handleSearch(req('?query=测试&songCount=15&f=json'))
    const body = JSON.parse(await res.text())

    // 两个源各 10 条 → 共 20，songCount=15 截断为 15
    expect(body['subsonic-response'].searchResult3.song).toHaveLength(15)
    // 每源恰好 1 次调用，参数 (src, query, 1, 10) —— 与改动前完全一致
    expect(search).toHaveBeenCalledTimes(2)
    expect(search).toHaveBeenCalledWith('wy', '测试', 1, 10)
    expect(search).toHaveBeenCalledWith('kg', '测试', 1, 10)
    // 结果写缓存（键含 query 与 count）
    expect(searchCache.set).toHaveBeenCalledTimes(1)
  })

  it('缓存命中时直接返回，不触发上游请求', async () => {
    const cached = { searchResult3: { song: [{ id: 'cached' }] } }
    vi.mocked(searchCache.get).mockReturnValue(cached as never)

    const res = await handleSearch(req('?query=测试&f=json'))
    const body = JSON.parse(await res.text())
    expect(body['subsonic-response'].searchResult3.song).toEqual([{ id: 'cached' }])

    const { search } = await import('./music-core/music-search')
    expect(search).not.toHaveBeenCalled()
  })
})
