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

const { getRecommendedPlaylistDetail, getRecommendedPlaylists, getToplistDetail } = await import('./discovery-service')

function txSong(id: number) {
  return { id, mid: `mid-${id}`, title: `歌曲${id}`, file: { media_mid: `media-${id}`, size_128mp3: 1024 } }
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

function txMusicuResponse(ids: number[], total: number, begin?: number) {
  return jsonResponse({ code: 0, req_1: { code: 0, data: {
    code: 0, subcode: 0, total_song_num: total, song_begin: begin,
    songlist: ids.map(txSong),
    dirinfo: { title: '甜度爆表 | 旋律说唱狙击少女心', picurl: 'http://example.com/cover.jpg', desc: '歌单简介', host_nick: '创建者' },
  } } })
}

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

  it('网易云歌单详情通过 Linux API 取得完整曲目 ID，再补全被截断的歌曲详情', async () => {
    const song = (id: number) => ({ id, name: `测试歌曲${id}`, ar: [{ name: '测试歌手' }], al: { id, name: '测试专辑' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          playlist: { name: '网易云歌单', trackIds: [{ id: 1 }, { id: 2 }], tracks: [song(1)] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 200, songs: [song(1), song(2)] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const detail = await getRecommendedPlaylistDetail('wy', 'wy-playlist')

    expect(detail?.tracks).toHaveLength(2)
    expect(new URL(fetchMock.mock.calls[0]?.[0]).pathname).toBe('/api/linux/forward')
    expect(new URL(fetchMock.mock.calls[1]?.[0]).pathname).toBe('/weapi/v3/song/detail')
  })

  const kwSongs = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ id: start + index, name: `歌曲${start + index}` }))

  it.each([1828, 1223, 2000])('酷我大歌单完整取得 %i 首，再一次性入库', async total => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const params = new URL(url).searchParams
      const page = Number(params.get('pn'))
      expect(params.get('rn')).toBe('1000')
      return jsonResponse({ result: 'ok', total: String(total), title: '歌单 &amp; 精选', info: '简介&nbsp;内容', uname: '&#x521B;建者', musiclist: kwSongs(page * 1000 + 1, Math.min(1000, total - page * 1000)) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const detail = await getRecommendedPlaylistDetail('kw', '3693016095')
    expect(detail?.tracks.map(song => song.songmid)).toEqual(Array.from({ length: total }, (_, index) => String(index + 1)))
    expect(detail).toMatchObject({ name: '歌单 & 精选', description: '简介\u00a0内容', author: '创建者' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(upsertMusicInfosInTransaction).toHaveBeenCalledTimes(1)
    expect(upsertMusicInfosInTransaction.mock.calls[0][0]).toHaveLength(total)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it.each([
    { result: 'error', total: 2000, musiclist: [], error: '获取失败' },
    { result: 'ok', total: 2000, musiclist: [], error: '获取不完整' },
    { result: 'ok', total: 2000, musiclist: kwSongs(1, 1000), error: '分页重复' },
    { result: 'ok', total: 2001, musiclist: kwSongs(1001, 1000), error: '总数在分页期间发生变化' },
  ])('酷我后续页异常时不入库、不缓存：$error', async ({ error, ...body }) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ result: 'ok', total: 2000, musiclist: kwSongs(1, 1000) }))
      .mockResolvedValueOnce(jsonResponse(body)))
    await expect(getRecommendedPlaylistDetail('kw', 'large-playlist')).rejects.toThrow(error)
    expect(upsertMusicInfosInTransaction).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('酷我空歌单正常返回，不继续翻页', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: 'ok', total: 0, musiclist: [] }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await getRecommendedPlaylistDetail('kw', 'empty'))?.tracks).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('酷狗歌单和榜单保留 albumAudioId，不改变歌曲 UID', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => jsonResponse({ data: url.includes('/special/info')
      ? { specialname: '歌单' }
      : { total: 1, info: [{ audio_id: 123, album_audio_id: 456, songname: '歌曲', hash: 'hash', filesize: 1024 }] },
    }))
    vi.stubGlobal('fetch', fetchMock)
    for (const detail of [await getRecommendedPlaylistDetail('kg', '123'), await getToplistDetail('kg', '8888')]) {
      expect(detail?.tracks[0]).toMatchObject({ songmid: '123', uid: 'kg-123', albumAudioId: 456 })
    }
    expect(upsertMusicInfosInTransaction.mock.calls[0][0][0]).toMatchObject({ albumAudioId: 456 })
  })

  it('QQ 7707261125 旧接口返回 subcode=4000 时，按 LX 备用接口获取完整的 66 首歌', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, subcode: 4000, msg: 'check privacy error!' }))
      .mockResolvedValueOnce(txMusicuResponse(Array.from({ length: 66 }, (_, index) => index + 1), 66))
    vi.stubGlobal('fetch', fetchMock)

    const detail = await getRecommendedPlaylistDetail('tx', '7707261125')

    expect(detail).toMatchObject({
      id: '7707261125', name: '甜度爆表 | 旋律说唱狙击少女心',
      cover: 'https://example.com/cover.jpg', author: '创建者', description: '歌单简介',
    })
    expect(detail?.tracks).toHaveLength(66)
    expect(detail?.tracks[0]).toMatchObject({ uid: 'tx-mid-1', songmid: 'mid-1', strMediaMid: 'media-1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg')
    expect(init.headers).toMatchObject({ Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/n/yqq/playsquare/7707261125.html' })
    expect(JSON.parse(init.body as string)).toMatchObject({
      comm: { cv: 4747474, ct: 24 },
      req_1: { module: 'music.srfDissInfo.aiDissInfo', method: 'uniform_get_Dissinfo', param: { disstid: 7707261125, song_begin: 0, song_num: 1000 } },
    })
    expect(upsertMusicInfosInTransaction).toHaveBeenCalledTimes(1)
    expect(upsertMusicInfosInTransaction.mock.calls[0][0]).toHaveLength(66)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('备用接口按实际返回数量翻页，使用 total_song_num 校验完整性', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, subcode: 0 }))
      .mockResolvedValueOnce(txMusicuResponse([1, 2], 3))
      .mockResolvedValueOnce(txMusicuResponse([3], 3))
    vi.stubGlobal('fetch', fetchMock)

    const detail = await getRecommendedPlaylistDetail('tx', '7707261125')

    expect(detail?.tracks.map(song => song.songmid)).toEqual(['mid-1', 'mid-2', 'mid-3'])
    expect(fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(init.body).req_1.param.song_begin)).toEqual([0, 2])
  })

  it('旧接口后续页失败时，从备用接口首页重取，避免混合两个接口的排序', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, cdlist: [{ songnum: 3, songlist: [txSong(1), txSong(2)] }] }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, subcode: 4000 }))
      .mockResolvedValueOnce(txMusicuResponse([3, 1, 2], 3))
    vi.stubGlobal('fetch', fetchMock)

    const detail = await getRecommendedPlaylistDetail('tx', '7707261125')

    expect(detail?.tracks.map(song => song.songmid)).toEqual(['mid-3', 'mid-1', 'mid-2'])
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('song_begin')).toBe('2')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).req_1.param.song_begin).toBe(0)
    expect(upsertMusicInfosInTransaction).toHaveBeenCalledTimes(1)
  })

  it('旧接口网络失败时也可通过备用接口恢复', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(txMusicuResponse([1], 1))
    vi.stubGlobal('fetch', fetchMock)
    expect((await getRecommendedPlaylistDetail('tx', '7707261125'))?.tracks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    { code: 1000 },
    { code: 0, req_1: { code: 1000 } },
    { code: 0, req_1: { code: 0, data: { code: 0, subcode: 4000, songlist: [] } } },
    { code: 0, req_1: { code: 0, data: {} } },
  ])('备用接口返回错误或缺少歌曲列表时，不写库或缓存：%j', async body => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, subcode: 4000 }))
      .mockResolvedValueOnce(jsonResponse(body))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getRecommendedPlaylistDetail('tx', '7707261125')).rejects.toThrow('QQ 歌单备用接口失败：code=')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(upsertMusicInfosInTransaction).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it.each([
    { ids: [], begin: 2, error: '获取不完整' },
    { ids: [1, 2], begin: 2, error: '分页重复返回' },
    { ids: [3, 4], begin: 0, error: '分页偏移异常' },
  ])('备用接口分页异常时停止读取：$error', async ({ ids, begin, error }) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, subcode: 4000 }))
      .mockResolvedValueOnce(txMusicuResponse([1, 2], 4))
      .mockResolvedValueOnce(txMusicuResponse(ids, 4, begin))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getRecommendedPlaylistDetail('tx', '7707261125')).rejects.toThrow(error)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(upsertMusicInfosInTransaction).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
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

  it('按 lxserver 的单次曲目数量请求酷我、酷狗和咪咕歌单', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'ok', title: '酷我歌单', musiclist: [{ id: 'kw-1', name: '酷我歌曲' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { info: [{ audio_id: 'kg-1', songname: '酷狗歌曲', hash: 'hash', filesize: 1 }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { specialname: '酷狗歌单' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: '000000', data: { songList: [{ songId: 'mg-1', songName: '咪咕歌曲' }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: '000000', data: { title: '咪咕歌单' } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await getRecommendedPlaylistDetail('kw', 'kw-playlist')
    await getRecommendedPlaylistDetail('kg', 'kg-playlist')
    await getRecommendedPlaylistDetail('mg', 'mg-playlist')

    const requestUrls = fetchMock.mock.calls.map(([url]) => new URL(url as string))
    expect(requestUrls[0].searchParams.get('rn')).toBe('1000')
    expect(requestUrls[1].searchParams.get('pagesize')).toBe('10000')
    expect(requestUrls[3].searchParams.get('pageSize')).toBe('50')
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

  it('QQ 推荐使用 LX 推荐流，按偏移分页并直接解析列表元数据', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, playlist: { code: 0, data: { FeedRsp: {
      FromLimit: 400, HasMore: true, List: [
        { Playlist: { basic: { tid: 7922374693, title: '精选 &amp; 热门', creator: { nick: '作者 &amp; 歌迷' }, desc: '第一行<br/>第二行&nbsp;介绍', cover: { medium_url: 'http://example.com/medium.jpg' }, play_cnt: 123456, song_cnt: 1195 } } },
        { Playlist: { basic: { tid: '123', title: '默认封面', cover: { default_url: 'http://example.com/default.jpg' } } } },
        { Playlist: {} },
      ],
    } } } }))
    vi.stubGlobal('fetch', fetchMock)
    const playlists = await getRecommendedPlaylists('tx', 12, 2, { sort: 'recommend' })
    expect(playlists).toEqual([
      { id: '7922374693', name: '精选 & 热门', author: '作者 & 歌迷', description: '第一行\n第二行\u00a0介绍', cover: 'https://example.com/medium.jpg', playCount: 123456, songCount: 1195, source: 'tx' },
      { id: '123', name: '默认封面', author: 'QQ 音乐', description: '', cover: 'https://example.com/default.jpg', playCount: 0, source: 'tx' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      comm: { cv: 1602, ct: 20 },
      playlist: { module: 'music.playlist.PlaylistSquare', method: 'GetRecommendWhole', param: { IsReqFeed: true, FeedReq: { From: 12, Size: 12 } } },
    })
    expect(upsertMusicInfosInTransaction).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.stringContaining(':recommend:'), playlists, 600000)
  })

  it.each([
    { code: 1 },
    { code: 0, playlist: { code: 1 } },
    { code: 0, playlist: { code: 0, data: {} } },
    { code: 0, playlist: { code: 0, data: { FeedRsp: { HasMore: true } } } },
  ])('QQ 推荐异常不能当作空列表缓存：%j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))
    await expect(getRecommendedPlaylists('tx', 12, 1, { sort: 'recommend' })).rejects.toThrow('QQ 推荐歌单接口失败')
    expect(set).not.toHaveBeenCalled()
  })

  it.each([
    { page: 1, feed: { List: [], HasMore: false, FromLimit: 0 } },
    { page: 1, feed: { HasMore: false, FromLimit: 0 } },
    { page: 35, feed: { List: null, HasMore: false, FromLimit: 400 } },
    { page: 35, feed: { List: [{ Playlist: { basic: { tid: 1, title: '重复首页' } } }], FromLimit: 400 } },
  ])('QQ 推荐空列表或超出上游范围时正常结束分页：$page', async ({ page, feed }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 0, playlist: { code: 0, data: { FeedRsp: feed } } })))
    expect(await getRecommendedPlaylists('tx', 12, page, { sort: 'recommend' })).toEqual([])
  })

  it('QQ 推荐尾页按 FromLimit 截取，避免总量 400 时仍返回完整 12 条', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 0, playlist: { code: 0, data: { FeedRsp: {
      FromLimit: 400, HasMore: false,
      List: Array.from({ length: 12 }, (_, index) => ({ Playlist: { basic: { tid: 397 + index, title: '推荐歌单' } } })),
    } } } })))
    expect((await getRecommendedPlaylists('tx', 12, 34, { sort: 'recommend' })).map(item => item.id)).toEqual(['397', '398', '399', '400'])
  })

  it.each([{ sort: 'hot', order: 5 }, { sort: 'new', order: 2 }] as const)('QQ $sort 继续读取对应列表', async ({ sort, order }) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, playlist: { code: 0, data: { v_playlist: [{ tid: 123, title: '歌单' }] } } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getRecommendedPlaylists('tx', 12, 2, { sort })).toHaveLength(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).playlist).toMatchObject({ method: 'get_playlist_by_tag', param: { sin: 12, order } })
  })

  it('QQ 推荐下选择具体分类时，按 LX 规则读取分类列表', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, playlist: { code: 0, data: { content: { v_item: [{ basic: { tid: 123, title: '官方歌单' } }] } } } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getRecommendedPlaylists('tx', 12, 1, { sort: 'recommend', tag: '3317' })).toHaveLength(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).playlist).toMatchObject({ method: 'get_category_content', param: { category_id: 3317 } })
  })

  it.each([12, 20, 30])('酷狗每页 %i 个时连续翻页不遗漏、不重复，并保留分类与排序', async limit => {
    const all = Array.from({ length: 103 }, (_, index) => ({ specialid: index + 1, specialname: `歌单${index + 1}` }))
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const params = new URL(url).searchParams
      expect(params.get('c')).toBe('华语 & 流行')
      expect(params.get('t')).toBe('6')
      const page = Number(params.get('p'))
      return jsonResponse({ status: 1, special_db: all.slice((page - 1) * 20, page * 20) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ids: string[] = []
    for (let page = 1; page <= Math.ceil(all.length / limit); page++) {
      const playlists = await getRecommendedPlaylists('kg', limit, page, { tag: '华语 & 流行', sort: 'hot' })
      expect(playlists).toHaveLength(Math.min(limit, all.length - (page - 1) * limit))
      ids.push(...playlists.map(item => item.id))
    }
    expect(ids).toEqual(all.map(item => String(item.specialid)))
    expect(await getRecommendedPlaylists('kg', limit, Math.ceil(all.length / limit) + 1, { tag: '华语 & 流行', sort: 'hot' })).toEqual([])
  })

  it('酷狗跨上游分页时，第二页失败不能缓存半页列表', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 1, special_db: Array.from({ length: 20 }, (_, index) => ({ specialid: index + 1, specialname: `歌单${index + 1}` })) }))
      .mockResolvedValueOnce(jsonResponse({ status: 0 })))
    await expect(getRecommendedPlaylists('kg', 12, 2)).rejects.toThrow('酷狗未返回推荐歌单')
    expect(set).not.toHaveBeenCalled()
  })

  it('酷我歌单搜索解码名称、作者和简介中的 HTML 实体', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ abslist: [
      { playlistid: 123, name: 'A &amp; B', nickname: '&#x521B;建者', intro: '内容&nbsp;&quot;介绍&quot;' },
    ] }) }))
    expect(await getRecommendedPlaylists('kw', 12, 1, { keyword: '周杰伦' })).toEqual([expect.objectContaining({
      id: '123', name: 'A & B', author: '创建者', description: '内容\u00a0"介绍"',
    })])
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

    const playlists = await getRecommendedPlaylists('tx', 12, 2, { keyword: '周杰伦', tag: '3317', sort: 'recommend' })

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
