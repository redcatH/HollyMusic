/**
 * app/api/lyrics/route.ts 集成测试
 *
 * 鉴权（未登录 401 / 已登录放行）+ 正常歌词返回。
 * 通过 vi.mock 隔离 requireUser / db / lyrics 服务，不触达真实 DB/网络。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// --- mock requireUser / AuthError -----------------------------------------

type AuthMode = 'ok' | 'unauth'

let authMode: AuthMode = 'ok'

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
    return { username: 'tester' }
  }),
  AuthError: MockAuthError,
}))

// --- mock db / lyrics 服务 ---------------------------------------------------

vi.mock('@/lib/db', () => ({
  resolveMusicInfoById: vi.fn(async () => ({
    songmid: '196030664',
    source: 'kw',
    name: '杀死那个石家庄人',
    singer: '万能青年旅店',
  })),
}))

vi.mock('@/lib/services/lyrics', () => ({
  fetchLyricForMusic: vi.fn(async () => ({
    lyric: '[00:00.00]杀死那个石家庄人',
    tlyric: null,
  })),
}))

// --- 辅助 ------------------------------------------------------------------

function makeGetRequest(id?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/lyrics')
  if (id) url.searchParams.set('id', id)
  return new NextRequest(url)
}

// 延迟导入，确保 vi.mock 先生效
const { GET } = await import('./route')

describe('GET /api/lyrics', () => {
  beforeEach(() => {
    authMode = 'ok'
  })

  it('未登录返回 401', async () => {
    authMode = 'unauth'
    const res = await GET(makeGetRequest('kw-196030664'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  it('已登录返回歌词', async () => {
    const res = await GET(makeGetRequest('kw-196030664'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.hasLyric).toBe(true)
    expect(json.data.lyric).toContain('石家庄人')
  })
})
