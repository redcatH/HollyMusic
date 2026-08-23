import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/favorites', () => ({
  default: {
    listFavorites: vi.fn(async () => []),
  },
}))

vi.mock('@/lib/db', () => ({
  default: {
    resolveMusicInfoById: vi.fn(),
  },
  getStorageSongmidForMusicInfo: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  normalizeSizeToBytes: vi.fn(() => '0'),
}))

const { handleGetStarred2 } = await import('./subsonic-getstarred')

describe('handleGetStarred2', () => {
  it('使用 OpenSubsonic 规定的 starred2 节点返回收藏列表', async () => {
    const response = await handleGetStarred2(
      new NextRequest('http://localhost/rest/getStarred2.view'),
      { user: { id: 1, username: 'tester' } } as never
    )

    const xml = await response.text()
    expect(response.status).toBe(200)
    // 空收藏集合可合法渲染为 XML 自闭合元素。
    expect(xml).toContain('<starred2/>')
  })

  it('在 JSON 模式下将收藏集合始终输出为数组', async () => {
    const response = await handleGetStarred2(
      new NextRequest('http://localhost/rest/getStarred2.view?f=json'),
      { user: { id: 1, username: 'tester' } } as never
    )

    await expect(response.json()).resolves.toEqual({
      'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        starred2: { artist: [], album: [], song: [] },
      },
    })
  })
})
