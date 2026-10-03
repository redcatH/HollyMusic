import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createPlaylist: vi.fn(),
  getPlaylistDetail: vi.fn(),
  addSongsToPlaylist: vi.fn(),
  getWySongsByIds: vi.fn(),
  upsertMusicInfosInTransaction: vi.fn(),
}))

vi.mock('@/lib/services/user-context', () => ({
  requireUser: mock.requireUser,
  AuthError: class AuthError extends Error { statusCode = 401 },
}))
vi.mock('@/lib/services/playlist-service', () => ({
  createPlaylist: mock.createPlaylist,
  getPlaylistDetail: mock.getPlaylistDetail,
  addSongsToPlaylist: mock.addSongsToPlaylist,
  PlaylistError: class extends Error {},
}))
vi.mock('@/lib/services/discovery-service', () => ({ getWySongsByIds: mock.getWySongsByIds }))
vi.mock('@/lib/db', () => ({ upsertMusicInfosInTransaction: mock.upsertMusicInfosInTransaction }))

const { POST } = await import('./route')

function makeRequest(csv: string, fields: Record<string, string> = {}) {
  const form = new FormData()
  form.set('file', new File([csv], '京津冀_56首.csv', { type: 'text/csv' }))
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return new NextRequest('http://localhost/api/playlists/import', { method: 'POST', body: form })
}

const fetchedSong = {
  source: 'wy', songmid: '186016', songId: 186016, name: '晴天', singer: '周杰伦', albumName: '叶惠美',
  interval: '269', types: [{ type: '320k', size: '8M' }], _types: { '320k': { size: '8M' } }, typeUrl: {},
}

describe('POST /api/playlists/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.requireUser.mockResolvedValue({ username: 'tester' })
    mock.createPlaylist.mockResolvedValue({ id: 7 })
    mock.getPlaylistDetail.mockResolvedValue({ entries: [], songCount: 0 })
    mock.getWySongsByIds.mockResolvedValue([fetchedSong])
    mock.upsertMusicInfosInTransaction.mockResolvedValue([])
    mock.addSongsToPlaylist.mockResolvedValue(undefined)
  })

  it('解析 CSV、补足真实音质并写入 wy UID', async () => {
    const response = await POST(makeRequest('序号,歌名,歌手,专辑,歌曲ID,时长\n1,晴天,周杰伦,叶惠美,186016,4:29'))
    expect(response.status).toBe(201)
    expect(mock.getWySongsByIds).toHaveBeenCalledWith(['186016'])
    expect(mock.upsertMusicInfosInTransaction).toHaveBeenCalledWith([fetchedSong])
    expect(mock.addSongsToPlaylist).toHaveBeenCalledWith(7, 'tester', ['wy-186016'])
  })

  it('网易详情缺失时保留 CSV 歌曲并写入 128k 兜底音质', async () => {
    mock.getWySongsByIds.mockResolvedValue([])
    const response = await POST(makeRequest('歌名,歌手,歌曲ID\n测试,歌手,123'))
    expect(response.status).toBe(201)
    const song = mock.upsertMusicInfosInTransaction.mock.calls[0][0][0]
    expect(song).toMatchObject({ source: 'wy', songmid: '123', importQualityFallback: true })
    expect(song.types).toEqual([{ type: '128k', size: '' }])
    expect(mock.addSongsToPlaylist).toHaveBeenCalledWith(7, 'tester', ['wy-123'])
  })

  it('未登录时拒绝导入', async () => {
    const { AuthError } = await import('@/lib/services/user-context')
    mock.requireUser.mockRejectedValue(new AuthError('未登录'))
    const response = await POST(makeRequest('歌名,歌手,歌曲ID\n测试,歌手,123'))
    expect(response.status).toBe(401)
  })
})
