import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describePlaybackError } from '@/lib/server/playback-diagnostics'
import { PLAYBACK_ATTEMPTS_HEADER, PLAYBACK_CANDIDATES_FAILED, PLAYBACK_ERROR_HEADER, PLAYBACK_REQUEST_ID_HEADER } from '@/lib/playback-protocol'
import type { MusicInfo } from '@/lib/types/music'

const { serve, request } = vi.hoisted(() => ({ serve: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/db', () => ({ getStorageSongmidForMusicInfo: (song: MusicInfo) => song.songmid }))
vi.mock('@/lib/audio-serve', () => ({ audioServe: { ensureInitialized: vi.fn(), serve } }))
vi.mock('@/lib/services/lyrics', () => ({ cacheNativeLyricForMusic: vi.fn() }))
vi.mock('@/lib/source-testing/network.cjs', () => ({ publicRequest: request }))
vi.mock('@/lib/music-source-manager', () => ({ musicSourceManager: {} }))

const { serveMusicAudio, verifyMusicAudio } = await import('./music-audio')
const { urlCache } = await import('@/lib/cache-manager')

const song: MusicInfo = {
  source: 'tx', songmid: 'song', name: '歌曲', singer: '歌手',
  interval: '03:00', types: [], _types: {}, typeUrl: {},
}

function flacHeader(sampleRate: number, channels: number, depth: number): Buffer {
  const header = Buffer.alloc(42)
  header.write('fLaC')
  header[4] = 0x80
  header.writeUIntBE(34, 5, 3)
  header.writeUInt32BE(sampleRate * 4096 + ((channels - 1) << 9) + ((depth - 1) << 4), 18)
  return header
}

beforeEach(() => {
  vi.resetAllMocks()
  urlCache.clear()
})

describe('音频回源与回退', () => {
  it('用 FLAC 文件内容校验母带与六声道，修正上游错误 MIME', async () => {
    request.mockResolvedValue({ status: 206, data: flacHeader(192000, 2, 24), headers: { 'content-type': 'audio/x-ogg' } })
    expect(await verifyMusicAudio('https://example.com/audio', 'master')).toEqual({
      contentType: 'audio/flac', audioSpec: '24 bit / 192 kHz / 2 ch',
    })
    await expect(verifyMusicAudio('https://example.com/audio', 'atmos_plus')).rejects.toThrow('六声道')
    request.mockResolvedValue({ status: 206, data: flacHeader(44100, 6, 16), headers: {} })
    expect((await verifyMusicAudio('https://example.com/audio', 'atmos_plus')).audioSpec).toBe('16 bit / 44.1 kHz / 6 ch')
  })

  it('六声道取流失败后按立体声偏好回退，Range 继续读取已选版本', async () => {
    serve.mockImplementation(async ({ cacheKey }) => cacheKey.endsWith(':flac')
      ? new Response(null, { status: 206 }) : new Response(null, { status: 502 }))
    const options = { musicInfo: song, quality: 'flac' as const, surround: true, isHead: false }
    const first = await serveMusicAudio({ ...options, rangeHeader: null })
    expect(first.headers.get('x-holly-quality')).toBe('flac')
    expect(serve.mock.calls.map(([call]) => call.cacheKey)).toEqual(['audio-v2:tx:song:atmos_plus', 'audio-v2:tx:song:flac'])
    serve.mockClear()
    const resumed = await serveMusicAudio({ ...options, rangeHeader: 'bytes=100-' })
    expect(resumed.status).toBe(206)
    expect(serve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cacheKey: 'audio-v2:tx:song:flac', rangeHeader: 'bytes=100-' }))
  })

  it('明确下载母带时不返回普通无损文件', async () => {
    serve.mockResolvedValue(new Response(null, { status: 502 }))
    const response = await serveMusicAudio({ musicInfo: song, quality: 'master', exact: true, rangeHeader: null, isHead: false })
    expect(response.status).toBe(502)
    expect(serve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cacheKey: 'audio-v2:tx:song:master' }))
  })

  it('提供 HEAD 排错信息，响应不含音频或错误正文', async () => {
    serve.mockResolvedValue(new Response('private upstream detail', {
      status: 502, headers: { [PLAYBACK_ERROR_HEADER]: 'AUDIO_PARSE_FAILED' },
    }))
    const response = await serveMusicAudio({
      musicInfo: song, quality: '128k', rangeHeader: null, isHead: true, requestId: 'test-request-id',
    })
    expect(response.status).toBe(502)
    expect(response.body).toBeNull()
    expect(response.headers.get(PLAYBACK_REQUEST_ID_HEADER)).toBe('test-request-id')
    expect(response.headers.get(PLAYBACK_ERROR_HEADER)).toBe(PLAYBACK_CANDIDATES_FAILED)
    expect(JSON.parse(response.headers.get(PLAYBACK_ATTEMPTS_HEADER)!)).toEqual([
      { quality: '128k', status: 502, code: 'AUDIO_PARSE_FAILED' },
    ])
  })

  it('解析失败时保留上游状态、内容类型和样本格式，省略响应正文', async () => {
    request.mockResolvedValue({
      status: 206, data: Buffer.from('{"token":"private-response"}'),
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-range': 'bytes 0-27/28' },
    })
    await expect(verifyMusicAudio('https://example.com/audio?token=private-url', '128k')).rejects.toMatchObject({
      code: 'AUDIO_PARSE_FAILED',
      details: { host: 'example.com', upstreamStatus: 206, contentType: 'application/json', sampleFormat: 'JSON-like', totalBytes: 28 },
    })
    const diagnostic = describePlaybackError(new Error('请求 https://example.com/path?token=private-url 失败，Authorization: Bearer private-header'))
    expect(diagnostic.message).toContain('失败')
    expect(diagnostic.message).not.toMatch(/example\.com|private-/)
  })
})
