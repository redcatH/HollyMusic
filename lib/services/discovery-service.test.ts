import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, set, getStorageSongmidForMusicInfo, upsertMusicInfosInTransaction } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getStorageSongmidForMusicInfo: vi.fn((musicInfo: { songmid: string }) => musicInfo.songmid),
  upsertMusicInfosInTransaction: vi.fn(),
}))

vi.mock('@/lib/cache-manager', () => ({ searchCache: { get, set } }))
vi.mock('@/lib/db', () => ({ getStorageSongmidForMusicInfo, upsertMusicInfosInTransaction }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { getRecommendedPlaylistDetail, getRecommendedPlaylists } = await import('./discovery-service')

describe('getRecommendedPlaylistDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    get.mockReturnValue(undefined)
    upsertMusicInfosInTransaction.mockResolvedValue(undefined)
  })

  it('TX 歌单详情缓存未命中时，按歌单 ID 直接请求详情而非回退到列表页', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        cdlist: [{
          dissname: '深翻页歌单', desc: '歌单简介', logo: 'http://example.com/cover.jpg', nickname: '创建者',
          songlist: [{
            id: 1, mid: 'song-mid', name: '测试歌曲', singer: [{ name: '测试歌手' }],
            album: { mid: 'album-mid', name: '测试专辑' }, interval: 180,
            file: { media_mid: 'media-mid', size_128mp3: 1024 },
          }],
        }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const detail = await getRecommendedPlaylistDetail('tx', 'deep-page-playlist')

    expect(detail).toMatchObject({
      id: 'deep-page-playlist', name: '深翻页歌单', author: '创建者', cover: 'https://example.com/cover.jpg',
    })
    expect(detail?.tracks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestUrl = new URL(url)
    expect(requestUrl.pathname).toBe('/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg')
    expect(requestUrl.searchParams.get('disstid')).toBe('deep-page-playlist')
    expect(requestUrl.searchParams.get('onlysong')).toBe('0')
    expect(init.headers).toMatchObject({
      Origin: 'https://y.qq.com',
      Referer: 'https://y.qq.com/n/yqq/playsquare/deep-page-playlist.html',
    })
  })

  it('将歌单歌曲作为单个事务批量入库', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        cdlist: [{
          songlist: [
            { id: 1, mid: 'song-mid-1', name: '歌曲一', singer: [{ name: '歌手' }], album: { mid: 'album-mid', name: '专辑' }, interval: 180, file: { media_mid: 'media-mid-1', size_128mp3: 1024 } },
            { id: 2, mid: 'song-mid-2', name: '歌曲二', singer: [{ name: '歌手' }], album: { mid: 'album-mid', name: '专辑' }, interval: 180, file: { media_mid: 'media-mid-2', size_128mp3: 1024 } },
          ],
        }],
      }),
    }))

    await getRecommendedPlaylistDetail('tx', 'serial-write-playlist')

    expect(upsertMusicInfosInTransaction).toHaveBeenCalledTimes(1)
    expect(upsertMusicInfosInTransaction.mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('批量入库失败时不返回或缓存不可播放的歌单详情', async () => {
    const databaseError = Object.assign(new Error('database timeout'), { code: 'P1008' })
    upsertMusicInfosInTransaction.mockRejectedValueOnce(databaseError)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        cdlist: [{
          songlist: [{
            id: 1, mid: 'song-mid', name: '测试歌曲', singer: [{ name: '测试歌手' }],
            album: { mid: 'album-mid', name: '测试专辑' }, interval: 180,
            file: { media_mid: 'media-mid', size_128mp3: 1024 },
          }],
        }],
      }),
    }))

    await expect(getRecommendedPlaylistDetail('tx', 'failed-transaction-playlist')).rejects.toBe(databaseError)
    expect(set).not.toHaveBeenCalled()
  })
})

describe('getRecommendedPlaylists', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    get.mockReturnValue(undefined)
  })

  it('传入关键词时调用 QQ 音乐的歌单搜索接口，而不是推荐歌单列表接口', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          list: [{
            dissid: '123', dissname: '周杰伦精选', creator: { name: '测试用户' },
            introduction: '搜索接口返回', imgurl: 'http://example.com/cover.jpg', listennum: 12000, song_count: 30,
          }],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const playlists = await getRecommendedPlaylists('tx', 12, 2, { keyword: '周杰伦', tag: '3317', sort: 'hot' })

    expect(playlists).toEqual([expect.objectContaining({
      id: '123', name: '周杰伦精选', author: '测试用户', source: 'tx', cover: 'https://example.com/cover.jpg', songCount: 30,
    })])
    const [url] = fetchMock.mock.calls[0] as [string]
    const requestUrl = new URL(url)
    expect(requestUrl.pathname).toBe('/soso/fcgi-bin/client_music_search_songlist')
    expect(requestUrl.searchParams.get('query')).toBe('周杰伦')
    expect(requestUrl.searchParams.get('page_no')).toBe('1')
    expect(requestUrl.searchParams.get('num_per_page')).toBe('12')
  })
})
