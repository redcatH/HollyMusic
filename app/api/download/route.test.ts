/**
 * app/api/download/route.ts 集成测试
 *
 * 两种模式：
 * - uid 模式（推荐）：复用 audioServe 磁盘缓存，mock audioServe.serve 返回
 * - url 模式（兼容）：直接代理上游，mock global fetch
 *
 * 通过 vi.mock 隔离 requireUser / resolveMusicInfoById / audioServe，不触达真实 DB/网络/缓存。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// --- mock resolveMusicInfoById --------------------------------------------

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

// --- mock audioServe -------------------------------------------------------

let audioServeResponse: Response

vi.mock('@/lib/audio-serve', () => ({
  audioServe: {
    ensureInitialized: vi.fn(async () => {}),
    serve: vi.fn(async () => audioServeResponse),
  },
}))

// --- 辅助 ------------------------------------------------------------------

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'))
}

// 延迟导入，确保 vi.mock 先生效
const { GET } = await import('./route')
const { audioServe } = await import('@/lib/audio-serve')

// ===========================================================================
// uid 模式
// ===========================================================================

describe('GET /api/download (uid 模式)', () => {
  beforeEach(() => {
    authMode = 'ok'
    resolveResult = {
      songmid: '196030664',
      source: 'kw',
      name: '杀死那个石家庄人',
      singer: '万能青年旅店',
    }
    audioServeResponse = new Response('audio-bytes', {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '11' },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('未登录 → 401', async () => {
    authMode = 'unauth'
    const req = makeGetRequest('/api/download?uid=kw-123&quality=320k')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('缺少 uid 和 url → 400', async () => {
    const req = makeGetRequest('/api/download?filename=x.mp3')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('不支持的音质 → 400', async () => {
    const req = makeGetRequest('/api/download?uid=kw-123&quality=lossless')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('uid 未找到 → 404', async () => {
    const req = makeGetRequest('/api/download?uid=not-found&quality=320k')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('缓存命中 → 200 + Content-Disposition: attachment（文件名后端组装）', async () => {
    // uid 模式不传 filename，后端用 resolveMusicInfoById 的 MusicInfo 组装
    // resolveResult: singer=万能青年旅店, name=杀死那个石家庄人
    const req = makeGetRequest('/api/download?uid=kw-196030664&quality=320k')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const cd = res.headers.get('content-disposition') ?? ''
    expect(cd).toContain('attachment')
    // 后端组装的文件名经 RFC 5987 编码（中文）
    expect(cd).toContain("filename*=UTF-8''")
    // 解码后应含歌名
    expect(decodeURIComponent(cd.split("filename*=UTF-8''")[1])).toBe('万能青年旅店 - 杀死那个石家庄人.mp3')
    // audioServe 的 Content-Type 被透传
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
  })

  it('前端传 filename 参数会被忽略（安全：uid 模式文件名完全后端控制）', async () => {
    // 即使前端传 filename，uid 模式也不读取，后端组装
    const req = makeGetRequest('/api/download?uid=kw-196030664&quality=320k&filename=evil.exe')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const cd = res.headers.get('content-disposition') ?? ''
    // 文件名是后端组装的 .mp3，不是前端传的 evil.exe
    expect(cd).not.toContain('evil')
    expect(cd).toContain('.mp3')
  })

  it('audioServe 返回 502 → 透传 502', async () => {
    audioServeResponse = new Response(JSON.stringify({ error: '上游错误' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
    const req = makeGetRequest('/api/download?uid=kw-123&quality=320k')
    const res = await GET(req)
    expect(res.status).toBe(502)
  })

  it('cacheKey 与 /api/audio 一致（复用缓存的关键）', async () => {
    const serveSpy = vi.mocked(audioServe.serve)
    const req = makeGetRequest('/api/download?uid=kw-196030664&quality=320k')
    await GET(req)
    expect(serveSpy).toHaveBeenCalledTimes(1)
    const arg = serveSpy.mock.calls[0][0]
    expect(arg.cacheKey).toBe('kw:196030664:320k')
  })

  it('rangeHeader 为 null（下载不发 Range）', async () => {
    const serveSpy = vi.mocked(audioServe.serve)
    const req = makeGetRequest('/api/download?uid=kw-196030664&quality=320k')
    await GET(req)
    const arg = serveSpy.mock.calls[0][0]
    expect(arg.rangeHeader).toBeNull()
  })
})

// ===========================================================================
// url 模式（兼容直链）
// ===========================================================================

describe('GET /api/download (url 模式)', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    authMode = 'ok'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('url 编码无效 → 400', async () => {
    const req = makeGetRequest('/api/download?url=%E0%A4%A&filename=song.mp3')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('远端 403 → 透传 403', async () => {
    globalThis.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as typeof fetch
    const req = makeGetRequest(
      '/api/download?url=' + encodeURIComponent('https://x.com/song.mp3') + '&filename=song.mp3'
    )
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('fetch 网络错误 → 502', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed: ENOTFOUND')
    }) as typeof fetch
    const req = makeGetRequest(
      '/api/download?url=' + encodeURIComponent('https://x.com/song.mp3') + '&filename=song.mp3'
    )
    const res = await GET(req)
    expect(res.status).toBe(502)
  })

  it('Content-Length 超过 500MB → 413', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('big', {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': String(501 * 1024 * 1024),
        },
      })
    ) as typeof fetch
    const req = makeGetRequest(
      '/api/download?url=' + encodeURIComponent('https://x.com/song.mp3') + '&filename=song.mp3'
    )
    const res = await GET(req)
    expect(res.status).toBe(413)
  })

  it('成功 → 200 + attachment + 携带 Referer', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response('audio', { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    ) as typeof fetch
    globalThis.fetch = fetchSpy
    const req = makeGetRequest(
      '/api/download?url=' + encodeURIComponent('https://musicapi.haitangw.net/kw.php?id=1') +
        '&filename=song.mp3'
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const [, init] = fetchSpy.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers['Referer']).toBe('https://haitangw.net')
  })
})
