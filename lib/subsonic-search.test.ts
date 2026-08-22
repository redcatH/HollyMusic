import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { listHistory } = vi.hoisted(() => ({
  listHistory: vi.fn(),
}))

vi.mock('@/lib/services/history-service', () => ({ listHistory }))
vi.mock('@/lib/db', () => ({
  getStorageSongmidForMusicInfo: (music: { songmid: string }) => music.songmid,
  upsertMusicInfo: vi.fn(),
}))

const { handleSearch } = await import('./subsonic-search')

describe('handleSearch', () => {
  it('将 Arrow Music 的 playDate 空搜索转换为当前用户的最近播放', async () => {
    listHistory.mockResolvedValueOnce({
      list: [{
        id: 1,
        songId: 'kw-123',
        playedAt: '2026-08-22T10:00:00.000Z',
        musicInfo: {
          source: 'kw',
          songmid: '123',
          name: '最近播放歌曲',
          singer: '测试歌手',
          interval: '3:00',
          types: [],
          _types: { '320k': { size: '1' } },
          typeUrl: {},
        },
      }],
      total: 1,
    })

    const response = await handleSearch(
      new NextRequest('http://localhost/rest/search3.view?f=json&query=&order=playDate&by=DESC&songCount=21&songOffset=0'),
      { user: { id: 1, username: 'tester' }, verified: true },
    )
    const payload = await response.json() as {
      'subsonic-response': { searchResult3: { song: Array<{ id: string; title: string }> } }
    }

    expect(listHistory).toHaveBeenCalledWith('tester', { limit: 21, offset: 0 })
    expect(payload['subsonic-response'].searchResult3.song).toEqual([
      expect.objectContaining({ id: 'kw-123', title: '最近播放歌曲' }),
    ])
  })
})
