import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { resolveMusicInfoById, reportPlay } = vi.hoisted(() => ({
  resolveMusicInfoById: vi.fn(),
  reportPlay: vi.fn(),
}))

vi.mock('./generated/prisma', () => ({
  PrismaClient: class {},
}))
vi.mock('./db', () => ({ resolveMusicInfoById }))
vi.mock('./services/history-service', () => ({ reportPlay }))

const { handleScrobble } = await import('./subsonic-system')

describe('handleScrobble', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('将 Subsonic 客户端上报的歌曲写入当前用户播放历史', async () => {
    const musicInfo = {
      source: 'kw', songmid: '123', name: '测试歌曲', singer: '测试歌手',
      interval: '3:00', types: [], _types: {}, typeUrl: {},
    }
    resolveMusicInfoById.mockResolvedValueOnce(musicInfo)

    const response = await handleScrobble(
      new NextRequest('http://localhost/rest/scrobble.view?id=kw-123'),
      { user: { id: 1, username: 'tester' }, verified: true },
    )

    expect(resolveMusicInfoById).toHaveBeenCalledWith('kw-123')
    expect(reportPlay).toHaveBeenCalledWith('tester', musicInfo)
    expect(await response.text()).toContain('status="ok"')
  })

  it('submission=false 的「正在播放」通知不写入播放历史', async () => {
    const response = await handleScrobble(
      new NextRequest('http://localhost/rest/scrobble.view?id=kw-123&submission=false'),
      { user: { id: 1, username: 'tester' }, verified: true },
    )

    expect(resolveMusicInfoById).not.toHaveBeenCalled()
    expect(reportPlay).not.toHaveBeenCalled()
    expect(await response.text()).toContain('status="ok"')
  })

  it('submission=true 的正式上报正常写入播放历史', async () => {
    const musicInfo = {
      source: 'kw', songmid: '456', name: '正式上报歌曲', singer: '测试歌手',
      interval: '3:00', types: [], _types: {}, typeUrl: {},
    }
    resolveMusicInfoById.mockResolvedValueOnce(musicInfo)

    const response = await handleScrobble(
      new NextRequest('http://localhost/rest/scrobble.view?id=kw-456&submission=true'),
      { user: { id: 1, username: 'tester' }, verified: true },
    )

    expect(reportPlay).toHaveBeenCalledTimes(1)
    expect(reportPlay).toHaveBeenCalledWith('tester', musicInfo)
    expect(await response.text()).toContain('status="ok"')
  })
})
