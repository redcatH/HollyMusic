import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { resolveMusicInfoById, getFirstMusicInfoByArtistAndTitle, fetchLyricForMusic } = vi.hoisted(() => ({
  resolveMusicInfoById: vi.fn(),
  getFirstMusicInfoByArtistAndTitle: vi.fn(),
  fetchLyricForMusic: vi.fn(),
}))

vi.mock('./db', () => ({
  resolveMusicInfoById,
  getFirstMusicInfoByArtistAndTitle,
}))

vi.mock('./services/lyrics', () => ({ fetchLyricForMusic }))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('./music-core/music-pic', () => ({ getPic: vi.fn() }))

const { handleGetLyricsAsync, handleGetLyricsBySongIdAsync } = await import('./subsonic-metadata')

const musicInfo = {
  source: 'kw',
  songmid: '123',
  name: '测试歌曲',
  singer: '测试歌手',
  albumName: '测试专辑',
  interval: '03:00',
  types: [],
  _types: {},
  typeUrl: {},
}

describe('Subsonic lyrics', () => {
  it('getLyrics 使用标准 lyrics.value，并通过统一歌词服务获取缓存内容', async () => {
    resolveMusicInfoById.mockResolvedValueOnce(musicInfo)
    fetchLyricForMusic.mockResolvedValueOnce({ lyric: '[00:01.00]第一句', tlyric: null })

    const response = await handleGetLyricsAsync(
      new NextRequest('http://localhost/rest/getLyrics.view?id=kw-123'),
      {} as never,
    )
    const xml = await response.text()

    expect(fetchLyricForMusic).toHaveBeenCalledWith(musicInfo)
    expect(xml).toContain('<lyrics artist="测试歌手" title="测试歌曲" value="[00:01.00]第一句"/>')
    expect(xml).not.toContain('<line')
  })

  it('传统 artist 与 title 参数可定位歌曲', async () => {
    getFirstMusicInfoByArtistAndTitle.mockResolvedValueOnce(musicInfo)
    fetchLyricForMusic.mockResolvedValueOnce({ lyric: '歌词正文', tlyric: null })

    const response = await handleGetLyricsAsync(
      new NextRequest('http://localhost/rest/getLyrics.view?f=json&artist=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%89%8B&title=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%9B%B2'),
      {} as never,
    )
    const body = await response.json() as { 'subsonic-response': { lyrics: { value: string } } }

    expect(getFirstMusicInfoByArtistAndTitle).toHaveBeenCalledWith('测试歌手', '测试歌曲')
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(body['subsonic-response'].lyrics.value).toBe('歌词正文')
  })

  it('getLyricsBySongId 同样复用统一歌词服务', async () => {
    resolveMusicInfoById.mockResolvedValueOnce(musicInfo)
    fetchLyricForMusic.mockResolvedValueOnce({ lyric: '[00:01.00]第一句', tlyric: null })

    const response = await handleGetLyricsBySongIdAsync(
      new NextRequest('http://localhost/rest/getLyricsBySongId.view?f=json&id=kw-123'),
      {} as never,
    )
    const body = await response.json() as { 'subsonic-response': { lyricsList: { structuredLyrics: unknown[] } } }

    expect(fetchLyricForMusic).toHaveBeenCalledWith(musicInfo)
    expect(body['subsonic-response'].lyricsList.structuredLyrics).toHaveLength(1)
  })
})
