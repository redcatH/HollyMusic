import { createDecipheriv } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as musicSearch from './music-search'

const request = require('./request')

beforeEach(() => {
  vi.spyOn(request, 'simpleFetch')
})
afterEach(() => vi.restoreAllMocks())

describe('网易单曲搜索', () => {
  it('使用新接口及分页参数，解析嵌套歌曲信息、音质和总数', async () => {
    vi.mocked(request.simpleFetch).mockResolvedValue({ code: 200, data: {
      totalCount: 61,
      resources: [{ baseInfo: { simpleSongData: {
        id: 123, name: '晴天', ar: [{ name: '周杰伦' }], al: { id: 456, name: '叶惠美', picUrl: 'https://example.com/cover' },
        dt: 269000, privilege: { maxbr: 999000, maxBrLevel: 'hires' },
        hr: { size: 4194304 }, sq: { size: 3145728 }, h: { size: 2097152 }, l: { size: 1048576 },
      } } }],
    } })
    const result = await musicSearch.wy.search('晴天 & live', 2, 30)
    const [url, init] = vi.mocked(request.simpleFetch).mock.calls[0]
    expect(url).toBe('https://interface.music.163.com/eapi/batch')
    const params = new URLSearchParams(init.body).get('params')!
    const decipher = createDecipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null)
    const decrypted = Buffer.concat([decipher.update(Buffer.from(params, 'hex')), decipher.final()]).toString()
    const [apiPath, body] = decrypted.split('-36cd479b6b5-')
    expect(apiPath).toBe('/api/search/song/list/page')
    expect(JSON.parse(body)).toEqual({ keyword: '晴天 & live', needCorrect: '1', channel: 'typing', scene: 'normal', limit: 30, offset: 30, total: false })
    expect(result).toMatchObject({ total: 61, page: 2, allPage: 3, limit: 30, source: 'wy' })
    expect(result.list[0]).toMatchObject({ songmid: '123', name: '晴天', singer: '周杰伦', albumId: 456, interval: '04:29' })
    expect(result.list[0].types.map((type: { type: string }) => type.type)).toEqual(['128k', '320k', 'flac', 'flac24bit'])
  })

  it('无搜索结果时正常返回，不重复请求', async () => {
    vi.mocked(request.simpleFetch).mockResolvedValue({ code: 200, data: { totalCount: 0, resources: [] } })
    expect(await musicSearch.wy.search('没有匹配歌曲')).toMatchObject({ list: [], total: 0, allPage: 0 })
    expect(request.simpleFetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { code: 200 },
    { code: 200, data: { totalCount: 1, resources: [] } },
    { code: 200, data: { resources: {} } },
    { code: 503 },
  ])('上游异常不能伪装为空结果，最多请求三次：%j', async body => {
    vi.mocked(request.simpleFetch).mockResolvedValue(body)
    await expect(musicSearch.wy.search('晴天')).rejects.toThrow('最大重试次数')
    expect(request.simpleFetch).toHaveBeenCalledTimes(3)
  })
})

describe('酷狗单曲搜索', () => {
  const song = {
    Audioid: 123, MixSongID: 456, FileHash: 'hash', FileSize: 1024,
    HQFileSize: 0, SQFileSize: 0, ResFileSize: 0,
    OriSongName: '晴天 &amp; 夜晚', Suffix: '(Live)', SongName: '旧显示名',
    Singers: [{ name: '歌手' }], AlbumName: '专辑', AlbumID: 'album', Duration: 180,
  }

  it('切换 AndroidFilter，保留原歌曲 ID 和分组去重，并新增专辑内歌曲标识', async () => {
    const child = { ...song, Audioid: 789, MixSongID: 987, FileHash: 'child-hash', Suffix: '(DJ版)' }
    vi.mocked(request.simpleFetch).mockResolvedValue({ error_code: 0, data: { total: 61, lists: [
      { ...song, Grp: [child, child] }, song,
    ] } })
    const result = await musicSearch.kg.search('晴天 & 夜晚', 2, 30)
    const url = new URL(vi.mocked(request.simpleFetch).mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toEqual({
      platform: 'AndroidFilter', iscorrection: '1', keyword: '晴天 & 夜晚', hifiquality: '0', pagesize: '30', PrivilegeFilter: '0', page: '2',
    })
    expect(result).toMatchObject({ total: 61, page: 2, allPage: 3 })
    expect(result.list).toHaveLength(2)
    expect(result.list[0]).toMatchObject({ songmid: 123, albumAudioId: 456, hash: 'hash', name: '晴天 & 夜晚 (Live)' })
    expect(result.list[1]).toMatchObject({ songmid: 789, albumAudioId: 987, hash: 'child-hash', name: '晴天 & 夜晚 (DJ版)' })
  })

  it('缺少原始歌名时保留旧名称，空结果不重复请求', async () => {
    expect(musicSearch.kg.formatItem({ ...song, OriSongName: undefined }).name).toBe('旧显示名')
    vi.mocked(request.simpleFetch).mockResolvedValue({ error_code: 0, data: { total: 0, lists: [] } })
    expect((await musicSearch.kg.search('没有匹配歌曲')).list).toEqual([])
    expect(request.simpleFetch).toHaveBeenCalledTimes(1)
  })
})
