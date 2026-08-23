/**
 * app/api/track/route.ts 集成测试
 *
 * 鉴权（未登录 401 / 已登录放行）+ 参数校验 + 元数据反查。
 * 通过 vi.mock 隔离 requireUser / db，不触达真实 DB。
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

// --- mock db -----------------------------------------------------------------

let resolveResult: { songmid: string; source: 'kw'; name: string; singer: string } | null = {
  songmid: '196030664',
  source: 'kw',
  name: '杀死那个石家庄人',
  singer: '万能青年旅店',
}

vi.mock('@/lib/db', () => ({
  resolveMusicInfoById: vi.fn(async (uid: string) => {
    if (uid === 'not-found') return null
    return resolveResult
  }),
}))

// --- 辅助 ------------------------------------------------------------------

function makeGetRequest(uid?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/track')
  if (uid) url.searchParams.set('uid', uid)
  return new NextRequest(url)
}

// 延迟导入，确保 vi.mock 先生效
const { GET } = await import('./route')

describe('GET /api/track', () => {
  beforeEach(() => {
    authMode = 'ok'
    resolveResult = {
      songmid: '196030664',
      source: 'kw',
      name: '杀死那个石家庄人',
      singer: '万能青年旅店',
    }
  })

  it('未登录返回 401', async () => {
    authMode = 'unauth'
    const res = await GET(makeGetRequest('kw-196030664'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  it('已登录但缺少 uid 返回 400', async () => {
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(400)
  })

  it('已登录且命中返回元数据', async () => {
    const res = await GET(makeGetRequest('kw-196030664'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.uid).toBe('kw-196030664')
    expect(json.data.musicInfo.name).toBe('杀死那个石家庄人')
  })

  it('已登录但歌曲不存在返回 404', async () => {
    const res = await GET(makeGetRequest('not-found'))
    expect(res.status).toBe(404)
  })
})
