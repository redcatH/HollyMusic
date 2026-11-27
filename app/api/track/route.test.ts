/**
 * app/api/track/route.ts 集成测试
 *
 * 鉴权（未登录 401 / 已登录放行）+ 参数校验 + 元数据反查。
 * 通过 vi.mock 隔离 requireUser / db，不触达真实 DB。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { searchCache } from '@/lib/cache-manager'
import type { MusicInfo } from '@/lib/types/music'

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

const oldSong: MusicInfo = {
  songmid: '196030664',
  source: 'kw',
  name: '杀死那个石家庄人',
  singer: '万能青年旅店',
  interval: '0',
  types: [{ type: 'flac', size: '20M' }],
  _types: { flac: { size: '20M' } },
  typeUrl: {},
}
let resolveResult = oldSong

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
const { GET, POST } = await import('./route')

describe('GET /api/track', () => {
  beforeEach(() => {
    authMode = 'ok'
    resolveResult = oldSong
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

describe('POST /api/track 批量音质', () => {
  function request(uids: unknown) {
    return new NextRequest('http://localhost:3000/api/track', { method: 'POST', body: JSON.stringify({ uids }) })
  }

  beforeEach(() => {
    authMode = 'ok'
    resolveResult = oldSong
    searchCache.clear()
  })

  it('校验登录、批量大小与歌曲 ID', async () => {
    authMode = 'unauth'
    expect((await POST(request(['kw-196030664']))).status).toBe(401)
    authMode = 'ok'
    expect((await POST(request(['https://example.com/']))).status).toBe(400)
    expect((await POST(request(Array(9).fill('kw-196030664')))).status).toBe(400)
  })

  it('旧记录合并新档位，去重并复用短期详情缓存', async () => {
    resolveResult = { ...oldSong, source: 'tx', songmid: 'testMid' }
    const fetchDetails = vi.fn(async () => Response.json({
      req: { data: { track_info: { file: { size_hires: 36_700_160, size_new: [52_428_800, 0, 73_400_320] } } } },
    }))
    vi.stubGlobal('fetch', fetchDetails)
    try {
      const res = await POST(request(['tx-testMid', 'tx-testMid']))
      expect((await res.json()).data).toEqual({ 'tx-testMid': [
        { type: 'flac', size: '20M' },
        { type: 'flac24bit', size: '35.00M', sizeBytes: 36_700_160 },
        { type: 'master', size: '50.00M', sizeBytes: 52_428_800 },
        { type: 'atmos_plus', size: '70.00M', sizeBytes: 73_400_320 },
      ] })
      await POST(request(['tx-testMid']))
      expect(fetchDetails).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('详情请求失败时保留旧档位', async () => {
    resolveResult = { ...oldSong, source: 'tx', songmid: 'failedMid' }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('upstream unavailable') }))
    try {
      const res = await POST(request(['tx-failedMid']))
      expect((await res.json()).data).toEqual({ 'tx-failedMid': oldSong.types })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
