import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({
  removeSongsFromPlaylist: vi.fn(),
}))

vi.mock('@/lib/services/user-context', () => ({
  requireUser: vi.fn(async () => ({ username: 'tester' })),
  AuthError: class extends Error {},
}))

vi.mock('@/lib/services/playlist-service', () => ({
  addSongsToPlaylist: vi.fn(),
  removeSongsFromPlaylist: mock.removeSongsFromPlaylist,
  PlaylistError: class extends Error {},
}))

const { DELETE } = await import('./route')

function deleteRequest(query: string) {
  return DELETE(
    new NextRequest(`http://localhost/api/playlists/7/songs?${query}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: '7' }) }
  )
}

describe('DELETE /api/playlists/[id]/songs', () => {
  beforeEach(() => {
    mock.removeSongsFromPlaylist.mockReset()
  })

  it('按稳定的条目 ID 删除', async () => {
    const response = await deleteRequest('entryId=42')

    expect(response.status).toBe(200)
    expect(mock.removeSongsFromPlaylist).toHaveBeenCalledWith(7, 'tester', [42])
  })

  it('拒绝旧的 position 参数和无效条目 ID', async () => {
    expect((await deleteRequest('positions=2')).status).toBe(400)
    expect((await deleteRequest('entryId=1.5')).status).toBe(400)
    expect(mock.removeSongsFromPlaylist).not.toHaveBeenCalled()
  })
})
