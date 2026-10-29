import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, set, upsert } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/cache-manager', () => ({ searchCache: { get, set } }))
vi.mock('@/lib/db', () => ({ upsertMusicInfosInTransaction: upsert, getStorageSongmidForMusicInfo: (song: { songmid: string }) => song.songmid }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
const { getToplistDetail } = await import('./discovery-service')

const json = (value: unknown) => ({ ok: true, json: async () => value })
const ids = (offset: number, count: number) => Array.from({ length: count }, (_, i) => offset + i + 1)
const txSong = (id: number) => ({ id, mid: `mid-${id}`, name: `歌曲${id}`, file: { media_mid: `file-${id}`, size_128mp3: 1024 } })

beforeEach(() => { vi.clearAllMocks(); get.mockReturnValue(null); upsert.mockResolvedValue(undefined) })
afterEach(() => vi.unstubAllGlobals())

describe('完整榜单', () => {
  it('QQ 按同一期数取得 300 个 ID，按 50 分批补齐并恢复上游排序', async () => {
    const offsets: number[] = []
    const batches: number[] = []
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('musicu.fcg')) {
        const param = JSON.parse(String(init.body)).toplist.param
        offsets.push(param.offset)
        expect(param.period).toBe(param.offset ? '2026-10-29' : '')
        return json({ toplist: { code: 0, data: { data: { totalNum: 300, period: '2026-10-29', title: '热歌榜', song: ids(param.offset, 100).map(songId => ({ songId })) } } } })
      }
      const batch = new URL(url).searchParams.get('songid')!.split(',').map(Number)
      batches.push(batch.length)
      return json({ code: 0, data: batch.reverse().map(txSong) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const [result, same] = await Promise.all([getToplistDetail('tx', '26'), getToplistDetail('tx', '26')])
    expect(same).toBe(result)
    expect(offsets).toEqual([0, 100, 200])
    expect(batches).toEqual([50, 50, 50, 50, 50, 50])
    expect(result?.tracks.map(song => song.songId)).toEqual(ids(0, 300))
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toHaveLength(300)
    expect(set).toHaveBeenCalledExactlyOnceWith('discovery:v3:tx:toplist:26', result, 600_000)
  })

  it.each(['kw', 'kg'] as const)('%s 分页获取总数并一次入库', async source => {
    const total = source === 'kw' ? 300 : 500
    const pages: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const params = new URL(url).searchParams
      const page = source === 'kw' ? Number(params.get('pn')) : Number(params.get('page')) - 1
      pages.push(page)
      const songs = ids(page * 100, 100)
      return source === 'kw'
        ? json({ num: String(total), pub: 'today', musiclist: songs.map(id => ({ id, name: `歌曲${id}` })) })
        : json({ data: { total, info: songs.map(id => ({ audio_id: id, hash: `hash-${id}`, songname: `歌曲${id}` })) } })
    }))
    const result = await getToplistDetail(source, source === 'kw' ? '16' : '8888')
    expect(pages).toEqual(ids(-1, total / 100))
    expect(result?.tracks).toHaveLength(total)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it.each(['short', 'repeat', 'changed-total', 'changed-version', 'missing-total'])('酷我异常分页 %s 不入库、不缓存', async kind => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('pn'))
      return json({ num: kind === 'missing-total' ? undefined : page && kind === 'changed-total' ? 301 : 300,
        pub: page && kind === 'changed-version' ? 'tomorrow' : 'today',
        musiclist: ids(kind === 'repeat' ? 0 : page * 100, page && kind === 'short' ? 20 : 100).map(id => ({ id, name: '歌曲' })),
      })
    }))
    await expect(getToplistDetail('kw', '16')).rejects.toThrow()
    expect(set).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('QQ 详情漏回 ID 时不能将部分榜单入库或缓存，下一次请求可恢复', async () => {
    let broken = true
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('musicu.fcg')
      ? json({ toplist: { code: 0, data: { data: { totalNum: 2, song: [{ songId: 1 }, { songId: 2 }] } } } })
      : json({ code: 0, data: (broken ? [1] : [2, 1]).map(txSong) })))
    await expect(getToplistDetail('tx', '26')).rejects.toThrow('不完整')
    expect(set).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    broken = false
    expect((await getToplistDetail('tx', '26'))?.tracks).toHaveLength(2)
  })

  it('完整缓存命中不请求上游', async () => {
    const detail = { id: '26', tracks: [] }
    get.mockReturnValue(detail)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await getToplistDetail('tx', '26')).toBe(detail)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
