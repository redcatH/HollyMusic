import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as musicSearch from './music-search'

const request = require('./request')
const { zzcSign } = require('./tx-search')
const SEARCH_MODULE = 'music.search.SearchCgiService'

const song = {
  id: 123,
  mid: 'song-mid',
  name: '旧名称',
  title: 'winter comes around again',
  title_extra: ' (Live)',
  singer: [{ name: '歌手一' }, { name: '歌手二' }],
  album: { mid: 'album-mid', name: '专辑' },
  interval: 185,
  file: { media_mid: 'media-mid', size_128mp3: 1048576, size_320mp3: 0 },
}

function response(songs: unknown[] = [song], total = 31) {
  return {
    statusCode: 200,
    body: {
      code: 0,
      [SEARCH_MODULE]: { code: 0, data: { body: { song: { list: songs } }, meta: { sum: total } } },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(request, 'httpFetch').mockImplementation(() => ({ promise: Promise.resolve(response()) }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('腾讯搜索签名', () => {
  // 固定向量来自 LX v2.12.6 的 utils/crypto.js，防止移植或编码改变签名。
  it.each([
    ['{}', 'zzcf8e26805gyafigxmxjehoe02mvsjjgtwzw6f1a05f9'],
    ['{"query":"winter comes around again"}', 'zzcbcd3b0cekeqrmbqxjaf2nhqnow35twqiub916c5b3'],
    ['{"query":"周杰伦 & 晴天"}', 'zzc99eaef2nmpvexlcwg9znvgcqo77qlxx3rue5d62ea6'],
  ])('与 LX 签名一致：%s', (text, expected) => {
    expect(zzcSign(text)).toBe(expected)
  })
})

describe('腾讯搜索', () => {
  it('使用签名 Desktop 请求，并保留播放标识、音质和分页信息', async () => {
    const result = await musicSearch.search('tx', 'winter comes around again', 2, 30)

    expect(request.httpFetch).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(request.httpFetch).mock.calls[0]
    expect(url).toBe(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${zzcSign(options.body)}`)
    expect(options).toMatchObject({
      method: 'post', json: true, timeout: 5000, read_timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)' },
    })
    expect(JSON.parse(options.body)).toMatchObject({
      comm: { ct: '19', cv: '2151', tmeAppID: 'qqmusic' },
      [SEARCH_MODULE]: {
        module: SEARCH_MODULE,
        method: 'DoSearchForQQMusicDesktop',
        param: {
          query: 'winter comes around again', page_num: 2, num_per_page: 30,
          search_type: 0, remoteplace: 'txt.newclient.top', searchid: expect.stringMatching(/^[A-F0-9]{32}\d{5}$/),
        },
      },
    })
    expect(result).toMatchObject({ total: 31, allPage: 2, page: 2, limit: 30, source: 'tx' })
    expect(result.list).toEqual([{
      name: 'winter comes around again', singer: '歌手一、歌手二',
      songmid: 'song-mid', songId: 123, strMediaMid: 'media-mid',
      albumId: 'album-mid', albumMid: 'album-mid', albumName: '专辑',
      source: 'tx', interval: '03:05', img: null,
      types: [{ type: '128k', size: '1.00M' }], _types: { '128k': { size: '1.00M' } }, typeUrl: {},
    }])
  })

  it('兼容 req/item_song 的响应结构与 estimate_sum', async () => {
    vi.mocked(request.httpFetch).mockReturnValueOnce({ promise: Promise.resolve({
      statusCode: 200,
      body: { code: '0', req: { code: '0', data: { body: { item_song: [song] }, meta: { estimate_sum: 7 } } } },
    }) })

    const result = await musicSearch.tx.search('winter comes around again')
    expect(result.total).toBe(7)
    expect(result.list[0].songmid).toBe('song-mid')
  })

  it('没有搜索结果时直接返回空列表，不触发重试', async () => {
    vi.mocked(request.httpFetch).mockReturnValueOnce({ promise: Promise.resolve(response([], 0)) })

    expect(await musicSearch.tx.search('不存在的歌曲')).toMatchObject({ list: [], total: 0, allPage: 0 })
    expect(request.httpFetch).toHaveBeenCalledTimes(1)
  })

  it('过滤缺失媒体 ID 的歌曲，并兼容缺失 title 的旧名称', async () => {
    vi.mocked(request.httpFetch).mockReturnValueOnce({ promise: Promise.resolve(response([
      { ...song, file: {} }, { ...song, title: undefined },
    ])) })

    const result = await musicSearch.tx.search('test')
    expect(result.list).toHaveLength(1)
    expect(result.list[0].name).toBe('旧名称 (Live)')
  })

  it('上游偶发拒绝后退避重试，并更新 searchid 与签名', async () => {
    vi.mocked(request.httpFetch).mockReturnValueOnce({ promise: Promise.resolve({
      statusCode: 200, body: { code: 0, [SEARCH_MODULE]: { code: 2001 } },
    }) })

    const pending = musicSearch.tx.search('test')
    await vi.advanceTimersByTimeAsync(249)
    expect(request.httpFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).list).toHaveLength(1)
    const calls = vi.mocked(request.httpFetch).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).not.toBe(calls[1][0])
    expect(JSON.parse(calls[0][1].body)[SEARCH_MODULE].param.searchid)
      .not.toBe(JSON.parse(calls[1][1].body)[SEARCH_MODULE].param.searchid)
  })

  it.each([429, 502])('HTTP %s 后可重试恢复', async statusCode => {
    vi.mocked(request.httpFetch).mockReturnValueOnce({ promise: Promise.resolve({ statusCode, body: '<html>error</html>' }) })
    const pending = musicSearch.tx.search('test')
    await vi.runAllTimersAsync()
    expect((await pending).list).toHaveLength(1)
    expect(request.httpFetch).toHaveBeenCalledTimes(2)
  })

  it('HTTP 403 立即报出状态码', async () => {
    vi.mocked(request.httpFetch).mockReturnValueOnce({ promise: Promise.resolve({ statusCode: 403, body: '' }) })
    await expect(musicSearch.tx.search('test')).rejects.toThrow('HTTP 403')
    expect(request.httpFetch).toHaveBeenCalledTimes(1)
  })

  it('持续上游拒绝最多请求三次，保留两层返回码', async () => {
    vi.mocked(request.httpFetch).mockImplementation(() => ({ promise: Promise.resolve({
      statusCode: 200, body: { code: 0, [SEARCH_MODULE]: { code: 2001 } },
    }) }))
    const rejected = expect(musicSearch.tx.search('test')).rejects.toThrow('HTTP 200, code=0, req.code=2001')
    await vi.runAllTimersAsync()
    await rejected
    expect(request.httpFetch).toHaveBeenCalledTimes(3)
  })

  it.each([null, {}, '<html>error</html>', { code: 0 }, { code: 0, req: { code: 0, data: {} } }])(
    '异常响应不会被当成空结果或抛出属性访问错误：%j', async body => {
      vi.mocked(request.httpFetch).mockImplementation(() => ({ promise: Promise.resolve({ statusCode: 200, body }) }))
      const rejected = expect(musicSearch.tx.search('test')).rejects.toThrow('腾讯搜索失败')
      await vi.runAllTimersAsync()
      await rejected
      expect(request.httpFetch).toHaveBeenCalledTimes(3)
    },
  )

  it('网络持续超时也有重试上限并保留原因', async () => {
    vi.mocked(request.httpFetch).mockImplementation(() => ({ promise: Promise.reject(new Error('请求超时')) }))
    const rejected = expect(musicSearch.tx.search('test')).rejects.toThrow('腾讯搜索请求失败：请求超时')
    await vi.runAllTimersAsync()
    await rejected
    expect(request.httpFetch).toHaveBeenCalledTimes(3)
  })
})
