/**
 * app/api/random/route.ts 集成测试
 *
 * 鉴权（未登录 401 / 已登录放行）+ 正常随机列表返回。
 * 通过 vi.mock 隔离 requireUser / db / search-config，不触达真实 DB。
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

// --- mock db / search-config -------------------------------------------------

vi.mock('@/lib/db', () => ({
  getRandomMusicInfoList: vi.fn(async () => [
    {
      songmid: '196030664',
      source: 'kw',
      name: '杀死那个石家庄人',
      singer: '万能青年旅店',
    },
  ]),
  getStorageSongmidForMusicInfo: vi.fn((mi: { songmid: string }) => mi.songmid),
}))

vi.mock('@/lib/search-config', () => ({
  getSearchSources: vi.fn(() => ['kw', 'tx']),
}))

// --- 辅助 ------------------------------------------------------------------

function makeGetRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/random?size=10'))
}

// 延迟导入，确保 vi.mock 先生效
const { GET } = await import('./route')

describe('GET /api/random', () => {
  beforeEach(() => {
    authMode = 'ok'
  })

  it('未登录返回 401', async () => {
    authMode = 'unauth'
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  it('已登录返回随机列表（附 uid）', async () => {
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.list).toHaveLength(1)
    expect(json.data.list[0].uid).toBe('kw-196030664')
  })
})
