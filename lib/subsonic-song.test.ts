import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { resolveMusicInfoById, getMusicInfoListByAlbumId } = vi.hoisted(() => ({
  resolveMusicInfoById: vi.fn(), getMusicInfoListByAlbumId: vi.fn(),
}))
vi.mock('./db', () => ({
  resolveMusicInfoById, getMusicInfoListByAlbumId,
  getStorageSongmidForMusicInfo: (song: { songmid: string }) => song.songmid,
}))
vi.mock('./services/lyrics', () => ({ fetchLyricForMusic: vi.fn() }))
vi.mock('./music-core/music-pic', () => ({ getPic: vi.fn() }))
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const { handleGetSongAsync } = await import('./subsonic-song')
const { handleGetAlbumAsync } = await import('./subsonic-metadata')

const music = {
  source: 'kw', songmid: '123', name: '歌曲', singer: '歌手', albumName: '专辑', albumId: 'album', interval: '03:00',
  types: [{ type: '320k', size: '8M' }, { type: 'flac', size: '25M' }, { type: 'flac24bit', size: '50M' }],
}
const auth = { user: null, verified: false }
beforeEach(() => {
  resolveMusicInfoById.mockResolvedValue(music)
  getMusicInfoListByAlbumId.mockResolvedValue([music])
})

describe('Subsonic 歌曲与专辑媒体信息', () => {
  it('详情 JSON 按最高档展示格式与大小，未知无损码率省略', async () => {
    const response = await handleGetSongAsync(new NextRequest('http://localhost/rest/getSong.view?id=kw-123&f=json'), auth)
    const song = (await response.json())['subsonic-response'].song
    expect(song).toMatchObject({ suffix: 'flac', contentType: 'audio/flac', size: 50 * 1024 * 1024, duration: 180 })
    expect(song.bitRate).toBeUndefined()
    expect(song.path).toMatch(/\.flac$/)
  })

  it('详情 XML 使用相同字段，不填造假的无损码率', async () => {
    const response = await handleGetSongAsync(new NextRequest('http://localhost/rest/getSong.view?id=kw-123'), auth)
    const xml = await response.text()
    expect(xml).toContain('suffix="flac"')
    expect(xml).toContain('size="52428800"')
    expect(xml).not.toContain('bitRate=')
  })

  it('缺少音质数据时不合成 MP3 扩展名', async () => {
    resolveMusicInfoById.mockResolvedValue({ ...music, types: [] })
    const response = await handleGetSongAsync(new NextRequest('http://localhost/rest/getSong.view?id=kw-123&f=json'), auth)
    const song = (await response.json())['subsonic-response'].song
    expect(song.suffix).toBeUndefined()
    expect(song.contentType).toBeUndefined()
    expect(song.path).toBe('歌手/专辑/歌曲')
  })

  it('专辑歌曲复用最高档元数据', async () => {
    const response = await handleGetAlbumAsync(new NextRequest('http://localhost/rest/getAlbum.view?id=kw-123&f=json'), auth)
    const songs = (await response.json())['subsonic-response'].album.song
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({ suffix: 'flac', size: 50 * 1024 * 1024 })
    expect(songs[0].bitRate).toBeUndefined()
  })
})
