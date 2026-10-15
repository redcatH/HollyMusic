import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { MusicInfo, QualityType } from './types/music'
import { resolveQuality } from './quality-options'

const { resolveMusicInfoById, getMusicUrl, serve, cacheNativeLyricForMusic } = vi.hoisted(() => ({
  resolveMusicInfoById: vi.fn(), getMusicUrl: vi.fn(), serve: vi.fn(), cacheNativeLyricForMusic: vi.fn(),
}))
vi.mock('./db', () => ({ resolveMusicInfoById }))
vi.mock('./music-source-manager', () => ({ musicSourceManager: {
  isInitialized: () => true, initialize: vi.fn(), getMusicUrl,
} }))
vi.mock('./audio-serve', () => ({ audioServe: { ensureInitialized: vi.fn(), serve } }))
vi.mock('./services/lyrics', () => ({ cacheNativeLyricForMusic }))
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { handleStream } = await import('./subsonic-stream')

function song(qualities: QualityType[]): MusicInfo {
  return {
    source: 'kw', songmid: '123', name: '歌曲', singer: '歌手', interval: '03:00',
    types: qualities.map(type => ({ type, size: '10M' })),
    _types: Object.fromEntries(qualities.map(type => [type, { size: '10M' }])) as MusicInfo['_types'],
    typeUrl: {},
  }
}
const ALL: QualityType[] = ['128k', '320k', 'flac', 'flac24bit']
const cases: Array<[string, QualityType[], QualityType]> = [
  ['', ALL, 'flac24bit'],
  ['maxBitRate=0', ['320k', 'flac'], 'flac'],
  ['format=raw', ['128k', '320k'], '320k'],
  ['format=raw&maxBitRate=320', ALL, 'flac24bit'],
  ['format=%20RAW%20&maxBitRate=broken', ALL, 'flac24bit'],
  ['format=flac', ALL, 'flac24bit'],
  ['format=%20MP3%20', ALL, '320k'],
  ['format=opus', ALL, 'flac24bit'],
  ['maxBitRate=', ALL, 'flac24bit'],
  ['maxBitRate=320', ['320k', 'flac'], '320k'],
  ['maxBitRate=320', ['128k', 'flac'], '128k'],
  ['maxBitRate=320', ['flac24bit', 'flac'], 'flac'],
  ['maxBitRate=128', ['flac', '320k'], '320k'],
  ['maxBitRate=192', ALL, '128k'],
  ['maxBitRate=256', ALL, '128k'],
  ['maxBitRate=319', ALL, '128k'],
  ['maxBitRate=500', ALL, '320k'],
  ['maxBitRate=800', ALL, '320k'],
  ['maxBitRate=96', ALL, '128k'],
  ['maxBitRate=%20320%20', ALL, '320k'],
]

beforeEach(() => {
  vi.clearAllMocks()
  getMusicUrl.mockResolvedValue('https://example.com/audio')
  serve.mockImplementation(async ({ upstreamUrlResolver }) => {
    await upstreamUrlResolver()
    return new Response('audio', { headers: { 'Content-Type': 'audio/flac' } })
  })
})

describe('Subsonic stream 音质与实际解析调用', () => {
  it.each(cases)('%s，支持 %j → %s', async (query, supported, expected) => {
    const music = song(supported)
    resolveMusicInfoById.mockResolvedValue(music)
    const response = await handleStream(new NextRequest(`http://localhost/rest/stream.view?id=kw-123&${query}`))
    expect(response.status).toBe(200)
    expect(getMusicUrl).toHaveBeenCalledWith(music, expected)
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({ cacheKey: `kw:123:${expected}` }))
  })

  it.each(['-1', 'abc', '320kb', '320.5', '1e3', '9007199254740992'])('非法 maxBitRate=%s 不解析音源', async value => {
    const response = await handleStream(new NextRequest(`http://localhost/rest/stream.view?id=kw-123&f=json&maxBitRate=${value}`))
    expect((await response.json())['subsonic-response']).toMatchObject({ status: 'failed', error: { code: 10 } })
    expect(resolveMusicInfoById).not.toHaveBeenCalled()
    expect(serve).not.toHaveBeenCalled()
  })

  it.each([{ supported: [] }, { supported: ['unknown' as QualityType] }])('无有效支持档位 $supported 返回协议错误', async ({ supported }) => {
    resolveMusicInfoById.mockResolvedValue(song(supported))
    const response = await handleStream(new NextRequest('http://localhost/rest/stream.view?id=kw-123&f=json'))
    expect((await response.json())['subsonic-response'].status).toBe('failed')
    expect(serve).not.toHaveBeenCalled()
  })

  it('同偏好与支持列表的选档与网页一致', async () => {
    for (let mask = 1; mask < 16; mask++) {
      const music = song(ALL.filter((_, index) => mask & (1 << index)))
      for (const [query, preference] of [['format=raw', 'flac24bit'], ['maxBitRate=320', '320k'], ['maxBitRate=128', '128k']] as const) {
        resolveMusicInfoById.mockResolvedValue(music)
        await handleStream(new NextRequest(`http://localhost/rest/stream.view?id=kw-123&${query}`))
        expect(getMusicUrl).toHaveBeenLastCalledWith(music, resolveQuality(preference, music.types))
      }
    }
  })

  it('缓存命中保持 Range 与 HEAD，不重新解析上游', async () => {
    resolveMusicInfoById.mockResolvedValue(song(ALL))
    serve.mockResolvedValue(new Response(null, { status: 206, headers: { 'Content-Type': 'audio/flac' } }))
    const response = await handleStream(new NextRequest('http://localhost/rest/stream.view?id=kw-123', {
      method: 'HEAD', headers: { Range: 'bytes=100-200' },
    }))
    expect(response.status).toBe(206)
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({
      cacheKey: 'kw:123:flac24bit', rangeHeader: 'bytes=100-200', isHead: true, intervalSec: 180,
    }))
    expect(getMusicUrl).not.toHaveBeenCalled()
    await serve.mock.calls[0][0].onCached()
    expect(cacheNativeLyricForMusic).toHaveBeenCalledTimes(1)
  })

  it('音频服务失败返回 Subsonic 错误', async () => {
    resolveMusicInfoById.mockResolvedValue(song(ALL))
    serve.mockResolvedValue(new Response('{"error":"upstream"}', { status: 502, headers: { 'Content-Type': 'application/json' } }))
    const response = await handleStream(new NextRequest('http://localhost/rest/stream.view?id=kw-123&f=json'))
    expect((await response.json())['subsonic-response'].status).toBe('failed')
  })
})
