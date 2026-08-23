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

const { handleGetLicense, handleScrobble } = await import('./subsonic-system')

describe('handleGetLicense', () => {
  it('向传统 Subsonic 客户端声明无需商业许可证', async () => {
    const response = handleGetLicense(
      new NextRequest('http://localhost/rest/getLicense.view?f=json'),
    )

    expect(await response.json()).toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        license: { valid: true },
      },
    })
  })
})

describe('handleScrobble', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('将缺省 submission 的 Subsonic 客户端上报写入当前用户播放历史', async () => {
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

  it('submission=false 的正在播放通知不写入播放历史', async () => {
    const response = await handleScrobble(
      new NextRequest('http://localhost/rest/scrobble.view?id=kw-123&submission=false'),
      { user: { id: 1, username: 'tester' }, verified: true },
    )

    expect(resolveMusicInfoById).not.toHaveBeenCalled()
    expect(reportPlay).not.toHaveBeenCalled()
    expect(await response.text()).toContain('status="ok"')
  })
})
