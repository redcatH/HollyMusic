import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { get, set, search, upsertMusicInfosInTransaction } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  search: vi.fn(),
  upsertMusicInfosInTransaction: vi.fn(),
}))

vi.mock('@/lib/services/user-context', () => ({
  requireUser: vi.fn(async () => ({ username: 'tester' })),
  AuthError: class AuthError extends Error {},
}))
vi.mock('@/lib/cache-manager', () => ({ searchCache: { get, set } }))
vi.mock('@/lib/db', () => ({
  getStorageSongmidForMusicInfo: vi.fn((musicInfo: { songmid: string }) => musicInfo.songmid),
  upsertMusicInfosInTransaction,
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/music-core/music-search', () => ({ search }))

const { GET } = await import('./route')

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/search?source=kw&keyword=test')
}

const songs = [
  { source: 'kw', songmid: 'one', name: '第一首', singer: '歌手' },
  { source: 'kw', songmid: 'two', name: '第二首', singer: '歌手' },
]

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    get.mockReturnValue(undefined)
    search.mockResolvedValue({ list: songs, total: songs.length })
    upsertMusicInfosInTransaction.mockResolvedValue([])
  })

  it('将一页搜索结果作为单次事务入库', async () => {
    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(upsertMusicInfosInTransaction).toHaveBeenCalledTimes(1)
    expect(upsertMusicInfosInTransaction).toHaveBeenCalledWith(songs)
    expect(set).toHaveBeenCalledTimes(1)
    expect((await response.json()).data.list.map((song: { uid: string }) => song.uid)).toEqual(['kw-one', 'kw-two'])
  })

  it('事务入库失败时不缓存不可播放的搜索结果', async () => {
    upsertMusicInfosInTransaction.mockRejectedValueOnce(new Error('database timeout'))

    const response = await GET(makeRequest())

    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR')
    expect(set).not.toHaveBeenCalled()
  })
})
