/**
 * app/api/music-url/route.ts 集成测试
 *
 * 鉴权（未登录 401 / 已登录放行）+ 参数校验 + 正常取链路。
 * 通过 vi.mock 隔离 requireUser / music-source-manager / urlCache，不触达真实 DB/网络/缓存。
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

// --- mock urlCache（避免用例间缓存串扰） ------------------------------------

vi.mock('@/lib/cache-manager', () => ({
  urlCache: {
    get: vi.fn(() => undefined),
    set: vi.fn(() => {}),
  },
}))

// --- mock music-source-manager ---------------------------------------------

vi.mock('@/lib/music-source-manager', () => ({
  musicSourceManager: {
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(async () => {}),
    getMusicUrl: vi.fn(async () => 'http://upstream.example.com/play/128k.mp3'),
  },
}))

// --- 辅助 ------------------------------------------------------------------

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/music-url'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const musicInfo = {
  name: '杀死那个石家庄人',
  singer: '万能青年旅店',
  source: 'kw',
  songmid: '196030664',
}

// 延迟导入，确保 vi.mock 先生效
const { POST } = await import('./route')

describe('POST /api/music-url', () => {
  beforeEach(() => {
    authMode = 'ok'
  })

  it('未登录返回 401', async () => {
    authMode = 'unauth'
    const res = await POST(makePostRequest({ musicInfo }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('UNAUTHORIZED')
  })

  it('已登录但缺少 musicInfo 返回 400', async () => {
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('已登录且参数完整返回播放 URL', async () => {
    const res = await POST(makePostRequest({ musicInfo, quality: '128k' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.url).toBe('http://upstream.example.com/play/128k.mp3')
  })
})
