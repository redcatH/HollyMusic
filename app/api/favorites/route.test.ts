/**
 * app/api/favorites/route.ts 集成测试
 *
 * P2d 回归守卫：limit/offset 参数校验（非法值回 400，绝不落进 Prisma take/skip）
 * + 鉴权 + 正常路径透传分页参数。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// --- mock requireUser / AuthError -------------------------------------------

let authMode: 'ok' | 'unauth' = 'ok'

class MockAuthError extends Error {
  statusCode = 401
  constructor(message = '未登录') {
    super(message)
    this.name = 'AuthError'
  }
}

vi.mock('@/lib/services/user-context', () => ({
  requireUser: vi.fn(async () => {
    if (authMode === 'unauth') throw new MockAuthError('未登录')
    return { id: 1, username: 'tester' }
  }),
  AuthError: MockAuthError,
}))

// --- mock favorites-service ---------------------------------------------------

const { listFavoriteSongs, starSong, unstarSong } = vi.hoisted(() => ({
  listFavoriteSongs: vi.fn(),
  starSong: vi.fn(),
  unstarSong: vi.fn(),
}))

vi.mock('@/lib/services/favorites-service', () => ({
  listFavoriteSongs,
  starSong,
  unstarSong,
}))

const { GET, POST, DELETE } = await import('./route')

beforeEach(() => {
  vi.clearAllMocks()
  authMode = 'ok'
  listFavoriteSongs.mockResolvedValue({ list: [], total: 0 })
  starSong.mockResolvedValue({ starred: true })
  unstarSong.mockResolvedValue({ starred: false })
})

describe('GET /api/favorites', () => {
  it('未登录返回 401', async () => {
    authMode = 'unauth'
    const res = await GET(new NextRequest('http://localhost/api/favorites'))
    expect(res.status).toBe(401)
    expect(listFavoriteSongs).not.toHaveBeenCalled()
  })

  it('默认分页 limit=200, offset=0', async () => {
    const res = await GET(new NextRequest('http://localhost/api/favorites'))
    expect(res.status).toBe(200)
    expect(listFavoriteSongs).toHaveBeenCalledWith(1, { limit: 200, offset: 0 })

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual({ list: [], total: 0 })
  })

  it('合法的 limit/offset 透传', async () => {
    await GET(new NextRequest('http://localhost/api/favorites?limit=50&offset=100'))
    expect(listFavoriteSongs).toHaveBeenCalledWith(1, { limit: 50, offset: 100 })
  })

  it('limit=500（单页上限）放行', async () => {
    const res = await GET(new NextRequest('http://localhost/api/favorites?limit=500'))
    expect(res.status).toBe(200)
    expect(listFavoriteSongs).toHaveBeenCalledWith(1, { limit: 500, offset: 0 })
  })

  it.each([
    ['limit=abc', 'limit 非数字'],
    ['limit=0', 'limit 小于 1'],
    ['limit=-10', 'limit 为负'],
    ['limit=501', 'limit 超过单页上限 500'],
    ['limit=1.5', 'limit 非整数'],
    ['offset=-1', 'offset 为负'],
    ['offset=xyz', 'offset 非数字'],
  ])('非法参数 %s（%s）返回 400 且不触达 service', async (query) => {
    const res = await GET(new NextRequest(`http://localhost/api/favorites?${query}`))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('INVALID_PARAMS')
    expect(listFavoriteSongs).not.toHaveBeenCalled()
  })

  it('limit/offset 为空字符串时回落默认值（与未传参等价）', async () => {
    await GET(new NextRequest('http://localhost/api/favorites?limit=&offset='))
    expect(listFavoriteSongs).toHaveBeenCalledWith(1, { limit: 200, offset: 0 })
  })
})

describe('POST /api/favorites', () => {
  it('携带 id 正常收藏', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'kw-123' }),
      })
    )
    expect(res.status).toBe(200)
    expect(starSong).toHaveBeenCalledWith(1, 'kw-123')
  })

  it('缺少 id 返回 400', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    )
    expect(res.status).toBe(400)
    expect(starSong).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/favorites', () => {
  it('携带 id 正常取消收藏', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/favorites?id=kw-123'))
    expect(res.status).toBe(200)
    expect(unstarSong).toHaveBeenCalledWith(1, 'kw-123')
  })

  it('缺少 id 返回 400', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/favorites'))
    expect(res.status).toBe(400)
    expect(unstarSong).not.toHaveBeenCalled()
  })
})
