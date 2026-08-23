import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, set, getStorageSongmidForMusicInfo, upsertMusicInfo } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getStorageSongmidForMusicInfo: vi.fn((musicInfo: { songmid: string }) => musicInfo.songmid),
  upsertMusicInfo: vi.fn(),
}))

vi.mock('@/lib/cache-manager', () => ({ searchCache: { get, set } }))
vi.mock('@/lib/db', () => ({ getStorageSongmidForMusicInfo, upsertMusicInfo }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { getRecommendedPlaylistDetail } = await import('./discovery-service')

describe('getRecommendedPlaylistDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    get.mockReturnValue(undefined)
    upsertMusicInfo.mockResolvedValue(undefined)
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
})
