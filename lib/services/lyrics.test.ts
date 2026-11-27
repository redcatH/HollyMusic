import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import { searchCache } from '@/lib/cache-manager'
import type { MusicInfo } from '@/lib/types/music'

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

vi.mock('@/lib/db', () => ({
  prisma: { audioCache: { findMany } },
  getStorageSongmidForMusicInfo: (musicInfo: MusicInfo) => musicInfo.source === 'kg' ? musicInfo.hash ?? musicInfo.songmid : musicInfo.songmid,
}))
vi.mock('@/lib/music-source-manager', () => ({ musicSourceManager: { getLyric } }))
vi.mock('@/lib/server/music-lyric', () => ({ fetchNativeLyric }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

vi.mock('fs/promises', () => {
  const api = { access, readFile, writeFile, rename, unlink }
  return { default: api, ...api }
})

const { cacheNativeLyricForMusic, fetchLyricForMusic } = await import('./lyrics')

const song: MusicInfo = {
  source: 'qs', songmid: '123', name: '测试歌曲', singer: '测试歌手',
  interval: '03:00', types: [], _types: {}, typeUrl: {},
}

beforeEach(() => {
  vi.resetAllMocks()
  searchCache.clear()
  access.mockResolvedValue(undefined)
  readFile.mockRejectedValue(new Error('sidecar missing'))
  fetchNativeLyric.mockResolvedValue(null)
})

afterEach(() => vi.useRealTimers())

describe('cacheNativeLyricForMusic', () => {
  it('原生接口无结果时，将渠道音源脚本返回的歌词写入缓存音频同级 .lrc', async () => {
    findMany.mockResolvedValue([{ filePath: 'aa/song.flac' }])
    getLyric.mockResolvedValue({ lyric: '[00:01.00]渠道歌词', tlyric: null })
    writeFile.mockResolvedValue(undefined)
    rename.mockResolvedValue(undefined)

    await cacheNativeLyricForMusic(song)

    const lyricPath = path.resolve('/audio-cache', 'aa', 'song.lrc')
    const tempPathPrefix = `${lyricPath}.tmp-`

    expect(getLyric).toHaveBeenCalled()
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { cacheKey: { in: expect.arrayContaining(['audio-v2:qs:123:flac', 'audio-v2:qs:123:320k']) } },
    }))
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining(tempPathPrefix),
      '[00:01.00]渠道歌词',
      'utf-8',
    )
    expect(rename).toHaveBeenCalledWith(
      expect.stringContaining(tempPathPrefix),
      lyricPath,
    )
  })

  it('切换音质时复用歌曲原有的歌词，酷狗按存储用的 FileHash 匹配', async () => {
    const lyric = '[00:01.00]本地歌词'
    const tlyric = '[00:01.00]本地翻译'
    findMany.mockImplementation(async ({ where }) => {
      expect(where.cacheKey.in).toContain('audio-v2:kg:file-hash:flac')
      expect(where.cacheKey.in).toContain('audio-v2:kg:file-hash:320k')
      expect(where.cacheKey.in).not.toContain('audio-v2:kg:123:flac')
      return [{ filePath: 'aa/new.mp3' }, { filePath: 'bb/original.flac' }]
    })
    readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('original.tlyric.lrc')) return tlyric
      if (filePath.endsWith('original.lrc')) return lyric
      throw new Error('sidecar missing')
    })
    const musicInfo = { ...song, source: 'kg', hash: 'file-hash' }
    await cacheNativeLyricForMusic(musicInfo)
    expect(await fetchLyricForMusic(musicInfo)).toEqual({ lyric, tlyric })
    expect(fetchNativeLyric).not.toHaveBeenCalled()
    expect(getLyric).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('新版记录缺少歌词时读取旧版磁盘歌词', async () => {
    const lyric = '[00:02.00]旧版歌词'
    findMany
      .mockResolvedValueOnce([{ filePath: 'aa/current.flac' }])
      .mockResolvedValueOnce([{ filePath: 'bb/previous.mp3' }])
    readFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('previous.lrc')) return lyric
      throw new Error('sidecar missing')
    })

    expect(await fetchLyricForMusic(song)).toEqual({ lyric, tlyric: null })
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { cacheKey: { in: expect.arrayContaining(['audio-v2:qs:123:flac']) } },
    }))
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { cacheKey: { in: ['qs:123:128k', 'qs:123:320k', 'qs:123:flac', 'qs:123:flac24bit'] } },
    }))
    expect(fetchNativeLyric).not.toHaveBeenCalled()
    expect(getLyric).not.toHaveBeenCalled()
  })

  it('合并同时发起的取词，短时间内跳过已确认缺词的歌曲', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    findMany.mockResolvedValue([])
    getLyric.mockResolvedValue(null)

    await Promise.all([cacheNativeLyricForMusic(song), cacheNativeLyricForMusic(song)])
    await cacheNativeLyricForMusic(song)
    expect(fetchNativeLyric).toHaveBeenCalledTimes(1)
    expect(getLyric).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 60_001)
    await cacheNativeLyricForMusic(song)
    expect(fetchNativeLyric).toHaveBeenCalledTimes(2)
    expect(getLyric).toHaveBeenCalledTimes(2)
  })
})
