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

// ---- 最小 M4A：按 ISO BMFF 标准布局手工构造，字段取任意值，不依赖外部文件 ----
const u8 = (n: number) => Buffer.from([n])
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
const u24 = (n: number) => { const b = Buffer.alloc(3); b.writeUIntBE(n, 0, 3); return b }
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const box = (type: string, ...payload: Buffer[]) => Buffer.concat([u32(8 + payload.reduce((sum, part) => sum + part.length, 0)), Buffer.from(type, 'latin1'), ...payload])
const zeros = (n: number) => Buffer.alloc(n)
const MATRIX = Buffer.concat([u32(0x10000), zeros(4), zeros(4), zeros(4), u32(0x10000), zeros(4), zeros(4), zeros(4), u32(0x40000000)])
const PROBE = 128 * 1024
const CHUNK = 64 * 1024

/** AAC 音轨：samples 个采样、每个 400 字节，双声道 44.1 kHz，外带 1 MiB 媒体数据。 */
function m4a(options: { samples?: number; moovFirst?: boolean } = {}) {
  const { samples = 1000, moovFirst = true } = options
  const mediaDuration = samples * 1024
  const ftyp = box('ftyp', Buffer.from('M4A '), u32(0), Buffer.from('M4A isomiso2'))
  const mvhd = box('mvhd', u8(0), u24(0), u32(0), u32(0), u32(44100), u32(mediaDuration), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2))
  const tkhd = box('tkhd', u8(0), u24(3), u32(0), u32(0), u32(1), u32(0), u32(mediaDuration), zeros(8), u16(0), u16(0), u16(0x100), u16(0), MATRIX, u32(0), u32(0))
  const mdhd = box('mdhd', u8(0), u24(0), u32(0), u32(0), u32(44100), u32(mediaDuration), u16(0x55c4), u16(0))
  const hdlr = box('hdlr', u32(0), Buffer.from('mhlr'), Buffer.from('soun'), zeros(12), Buffer.from('SoundHandler\0', 'latin1'))
  const mp4a = Buffer.concat([u32(36), Buffer.from('mp4a'), zeros(6), u16(1), u16(0), u16(0), u32(0), u16(2), u16(16), u16(0), u16(0), u32(44100 << 16)])
  const sizes = Buffer.alloc(samples * 4)
  for (let i = 0; i < samples; i++) sizes.writeUInt32BE(400, i * 4)
  const stbl = box('stbl',
    box('stsd', u32(0), u32(1), mp4a),
    box('stts', u32(0), u32(1), u32(samples), u32(1024)),
    box('stsc', u32(0), u32(1), u32(1), u32(samples), u32(1)),
    box('stsz', u32(0), u32(0), u32(samples), sizes),
    box('stco', u32(0), u32(1), u32(0)))
  const moov = box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf',
    box('smhd', u32(0), u16(0), u16(0)),
    box('dinf', box('dref', u32(0), u32(1), Buffer.concat([u32(12), Buffer.from('url ', 'latin1'), u32(1)]))),
    stbl))))
  const mdat = box('mdat', zeros(1024 * 1024))
  const layout = moovFirst ? [ftyp, moov, box('free'), mdat] : [ftyp, box('free'), mdat, moov]
  // [起点, 终点)，便于断言追加读取落在哪里
  const span = (part: Buffer): [number, number] => {
    const start = layout.slice(0, layout.indexOf(part)).reduce((sum, item) => sum + item.length, 0)
    return [start, start + part.length]
  }
  return { bytes: Buffer.concat(layout), moov: span(moov), mdat: span(mdat) }
}

/** 模拟支持 Range 的上游：按请求的区间返回文件切片。 */
function serveRanges(file: Buffer) {
  return async (_url: string, options: { headers: Record<string, string> }) => {
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range)!
    const data = file.subarray(Number(start), Number(end) + 1)
    return { status: 206, data, headers: { 'content-type': 'audio/mp4', 'content-range': `bytes ${start}-${Number(start) + data.length - 1}/${file.length}` } }
  }
}
const requestedRanges = () => request.mock.calls.map(([, options]: [string, { headers: Record<string, string> }]) => options.headers.Range)
const rangeOf = (header: string): [number, number] => {
  const [, start, end] = /bytes=(\d+)-(\d+)/.exec(header)!
  return [Number(start), Number(end)]
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

describe('MP4 元数据按需读取', () => {
  it('媒体数据超出采样时照常解析，不下载媒体数据', async () => {
    request.mockImplementation(serveRanges(m4a().bytes))
    expect(await verifyMusicAudio('https://example.com/a.m4a', '128k')).toEqual({ contentType: 'audio/mp4' })
    expect(request).toHaveBeenCalledExactlyOnceWith('https://example.com/a.m4a', expect.objectContaining({
      maxBytes: PROBE, headers: expect.objectContaining({ Range: `bytes=0-${PROBE - 1}` }),
    }))
  })

  it('元数据排在媒体数据之后时跳过媒体数据取回', async () => {
    const { bytes, moov, mdat } = m4a({ moovFirst: false })
    request.mockImplementation(serveRanges(bytes))
    expect(await verifyMusicAudio('https://example.com/a.m4a', '128k')).toEqual({ contentType: 'audio/mp4' })
    const ranges = requestedRanges().map(rangeOf)
    expect(ranges).toHaveLength(2)
    const [start, end] = ranges[1]
    // 只读元数据所在的那个块：媒体数据几乎全部被跳过
    expect(start).toBeGreaterThanOrEqual(mdat[1] - CHUNK)
    expect(start).toBeLessThan(moov[0])
    expect(end).toBe(bytes.length - 1)
    expect(end - start + 1).toBeLessThan(CHUNK + moov[1] - moov[0])
  })

  it('元数据超过采样大小时继续按块读取', async () => {
    request.mockImplementation(serveRanges(m4a({ samples: 60_000 }).bytes))
    expect(await verifyMusicAudio('https://example.com/a.m4a', '128k')).toEqual({ contentType: 'audio/mp4' })
    expect(requestedRanges()).toEqual([`bytes=0-${PROBE - 1}`, `bytes=${PROBE}-${PROBE + CHUNK - 1}`, `bytes=${PROBE + CHUNK}-${PROBE + 2 * CHUNK - 1}`])
  })

  /** 模拟忽略 Range 的上游：一律回 200 与文件开头。 */
  const wholeFile = (file: Buffer) => async () => ({ status: 200, data: file.subarray(0, PROBE), headers: { 'content-type': 'audio/mp4', 'content-length': String(file.length) } })

  it('上游不支持分段读取时，采样内已有全部元数据的文件仍可解析', async () => {
    const { bytes } = m4a()
    request.mockImplementation(wholeFile(bytes))
    expect(await verifyMusicAudio('https://example.com/a.m4a', '128k')).toEqual({ contentType: 'audio/mp4' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('上游不支持分段读取且元数据不在采样内时给出明确的错误', async () => {
    const { bytes } = m4a({ moovFirst: false })
    const ranges = serveRanges(bytes)
    request.mockImplementation(async (url: string, options: { headers: Record<string, string> }) => options.headers.Range === `bytes=0-${PROBE - 1}`
      ? ranges(url, options)
      : wholeFile(bytes)())
    await expect(verifyMusicAudio('https://example.com/a.m4a', '128k')).rejects.toMatchObject({
      code: 'AUDIO_PROBE_RANGE_UNSUPPORTED',
      details: { sampleFormat: 'ISO BMFF', totalBytes: bytes.length, upstreamStatus: 200, rangeStart: CHUNK * 16, rangeRequests: 1 },
    })
  })

  it('元数据已读到后，尾部读取失败不影响结果', async () => {
    // 媒体数据之后再放一个盒子，解析器需要补读它的头才能确认文件到此结束
    const file = Buffer.concat([m4a().bytes, box('free')])
    const ranges = serveRanges(file)
    request.mockImplementation(async (url: string, options: { headers: Record<string, string> }) => options.headers.Range === `bytes=0-${PROBE - 1}`
      ? ranges(url, options)
      : wholeFile(file)())
    expect(await verifyMusicAudio('https://example.com/a.m4a', '128k')).toEqual({ contentType: 'audio/mp4' })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('文件总长未知时按采样解析，不把本段长度当成文件大小', async () => {
    request.mockImplementation(async () => ({
      status: 206, data: m4a().bytes.subarray(0, PROBE), headers: { 'content-type': 'audio/mp4', 'content-range': `bytes 0-${PROBE - 1}/*` },
    }))
    await expect(verifyMusicAudio('https://example.com/a.m4a', '128k')).rejects.toMatchObject({
      code: 'AUDIO_PARSE_FAILED', details: { totalBytes: undefined },
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('码率与所选档位不符时仍然拒绝', async () => {
    request.mockImplementation(serveRanges(m4a().bytes))
    await expect(verifyMusicAudio('https://example.com/a.m4a', '320k')).rejects.toMatchObject({
      code: 'AUDIO_FORMAT_MISMATCH',
      details: { codec: 'MPEG-4/AAC', container: 'M4A/isom/iso2', sampleRate: 44100, numberOfChannels: 2, bitrate: expect.any(Number) },
    })
  })

  it('非 MP4 格式仍只解析采样', async () => {
    request.mockResolvedValue({ status: 206, data: flacHeader(96000, 2, 24), headers: {} })
    await expect(verifyMusicAudio('https://example.com/a.flac', 'flac24bit')).resolves.toEqual({ contentType: 'audio/flac', audioSpec: '24 bit / 96 kHz / 2 ch' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
