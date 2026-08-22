import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getRandomMusicInfoList, getSearchSources } = vi.hoisted(() => ({
  getRandomMusicInfoList: vi.fn(),
  getSearchSources: vi.fn(() => ['kw']),
}))

vi.mock('./db', () => ({
  getRandomMusicInfoList,
  getStorageSongmidForMusicInfo: (music: { songmid: string }) => music.songmid,
}))

vi.mock('./search-config', () => ({ getSearchSources }))

const { handleGetRandomSongs } = await import('./subsonic-random')

describe('handleGetRandomSongs', () => {
  it('兼容 Arrow Music 的 songCount，并将单首歌曲保持为数组', async () => {
    getRandomMusicInfoList.mockResolvedValueOnce([{
      source: 'kw',
      songmid: '123',
      name: '测试歌曲',
      singer: '测试歌手',
      albumName: '测试专辑',
      interval: '3:00',
      _types: { '320k': { size: 1 } },
    }])

    const response = await handleGetRandomSongs(
      new NextRequest('http://localhost/rest/getRandomSongs.view?f=json&songCount=21'),
    )
    const payload = await response.json() as {
      'subsonic-response': { randomSongs: { song: Array<{ id: string }> } }
    }

    expect(getRandomMusicInfoList).toHaveBeenCalledWith(21, ['kw'])
    expect(payload['subsonic-response'].randomSongs.song).toEqual([
      expect.objectContaining({ id: 'kw-123' }),
    ])
  })
})
