import { describe, expect, it, vi } from 'vitest'

const { findMany, getLyric, fetchNativeLyric, access, readFile, writeFile, rename, unlink } = vi.hoisted(() => ({
  findMany: vi.fn(),
  getLyric: vi.fn(),
  fetchNativeLyric: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('@/lib/audio-serve', () => ({
  getAudioServeConfig: () => ({ enabled: true, cacheDir: '/audio-cache' }),
}))

vi.mock('@/lib/db', () => ({ prisma: { audioCache: { findMany } } }))
vi.mock('@/lib/music-source-manager', () => ({ musicSourceManager: { getLyric } }))
vi.mock('@/lib/server/music-lyric', () => ({ fetchNativeLyric }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

vi.mock('fs/promises', () => {
  const api = { access, readFile, writeFile, rename, unlink }
  return { default: api, ...api }
})

const { cacheNativeLyricForMusic } = await import('./lyrics')

describe('cacheNativeLyricForMusic', () => {
  it('原生接口无结果时，将渠道音源脚本返回的歌词写入缓存音频同级 .lrc', async () => {
    findMany.mockResolvedValue([{ filePath: 'aa/song.flac' }])
    access.mockResolvedValue(undefined)
    readFile.mockRejectedValue(new Error('sidecar missing'))
    fetchNativeLyric.mockResolvedValue(null)
    getLyric.mockResolvedValue({ lyric: '[00:01.00]渠道歌词', tlyric: null })
    writeFile.mockResolvedValue(undefined)
    rename.mockResolvedValue(undefined)

    await cacheNativeLyricForMusic({
      source: 'kw', songmid: '123', name: '测试歌曲', singer: '测试歌手',
      interval: '03:00', types: [], _types: {}, typeUrl: {},
    })

    expect(getLyric).toHaveBeenCalled()
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/audio-cache\/aa\/song\.lrc\.tmp-/),
      '[00:01.00]渠道歌词',
      'utf-8',
    )
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/\/audio-cache\/aa\/song\.lrc\.tmp-/),
      '/audio-cache/aa/song.lrc',
    )
  })
})
