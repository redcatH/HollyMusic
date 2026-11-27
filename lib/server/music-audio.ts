import { randomUUID } from 'node:crypto'
import { parseBuffer } from 'music-metadata'
import { audioServe, type AudioUpstream } from '@/lib/audio-serve'
import { isIncompleteTrial } from '@/lib/audio-integrity'
import { urlCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'
import { musicSourceManager } from '@/lib/music-source-manager'
import { PLAYBACK_ATTEMPTS_HEADER, PLAYBACK_CANDIDATES_FAILED, PLAYBACK_ERROR_HEADER, PLAYBACK_QUALITY_HEADER, PLAYBACK_REQUEST_ID_HEADER } from '@/lib/playback-protocol'
import { QUALITY_ORDER, isQuality } from '@/lib/quality-options'
import { buildUpstreamHeaders } from '@/lib/server/download-utils'
import { formatFlacSpec } from '@/lib/server/flac-info'
import { getMusicAudioCacheKeyPrefix, getMusicAudioTrackKey } from '@/lib/server/music-audio-cache-key'
import { describePlaybackError, PlaybackError } from '@/lib/server/playback-diagnostics'
import { cacheNativeLyricForMusic } from '@/lib/services/lyrics'
import { publicRequest } from '@/lib/source-testing/network.cjs'
import type { MusicInfo, QualityType } from '@/lib/types/music'
import { parseIntervalToSeconds } from '@/lib/types/player'

const PROBE_BYTES = 128 * 1024
const FALLBACK_TTL_MS = 2 * 60_000
const PLAYBACK_BUDGET_MS = 24_000

function sampleFormat(data: Buffer): string {
  const signature = data.toString('ascii', 0, 12)
  if (signature.startsWith('fLaC')) return 'FLAC'
  if (signature.startsWith('ID3')) return 'ID3'
  if (signature.startsWith('OggS')) return 'Ogg'
  if (signature.slice(4, 8) === 'ftyp') return 'ISO BMFF'
  if (signature.startsWith('RIFF')) return 'RIFF'
  const prefix = data.toString('utf8', 0, 64).trimStart()
  if (prefix.startsWith('<')) return 'markup'
  if (prefix.startsWith('{') || prefix.startsWith('[')) return 'JSON-like'
  return data.length ? 'unknown' : 'empty'
}

export async function verifyMusicAudio(url: string, quality: QualityType, signal?: AbortSignal, intervalSec = 0): Promise<Omit<AudioUpstream, 'url'>> {
  const host = new URL(url).hostname
  const { status, data, headers } = await publicRequest(url, {
    maxBytes: PROBE_BYTES,
    partial: true,
    timeout: 4_500,
    signal,
    headers: { ...buildUpstreamHeaders(url), Range: `bytes=0-${PROBE_BYTES - 1}` },
  }).catch((cause: unknown) => {
    throw new PlaybackError('AUDIO_PROBE_NETWORK', '音频探测请求失败', { host }, cause)
  })

  const range = String(headers['content-range'] ?? '')
  const size = Number(/\/(\d+)$/.exec(range)?.[1] ?? headers['content-length'])
  const contentType = /^[\w.+-]+\/[\w.+-]+/.exec(String(headers['content-type'] ?? ''))?.[0]
  const details = { host, upstreamStatus: status, contentType, sampleBytes: data.length, sampleFormat: sampleFormat(data),
    contentRange: /^bytes \d+-\d+\/(?:\d+|\*)$/.test(range) ? range : undefined,
    totalBytes: Number.isSafeInteger(size) && size > 0 ? size : undefined,
  }
  if (status !== 200 && status !== 206) {
    throw new PlaybackError('AUDIO_PROBE_HTTP', '上游音频不可用', details)
  }
  const { format } = await parseBuffer(data, details.totalBytes ? { size: details.totalBytes } : undefined,
    { duration: false, skipCovers: true }).catch((cause: unknown) => {
    throw new PlaybackError('AUDIO_PARSE_FAILED', '音频采样解析失败', details, cause)
  })
  const { codec, container, sampleRate, bitsPerSample, numberOfChannels, bitrate } = format
  const mismatch = (message: string) => new PlaybackError('AUDIO_FORMAT_MISMATCH', message,
    { ...details, codec, container, sampleRate, bitsPerSample, numberOfChannels, bitrate })
  if (format.duration && intervalSec && isIncompleteTrial(format.duration, intervalSec)) {
    throw new PlaybackError('AUDIO_TRIAL', '上游返回试听片段', { ...details, expectedSeconds: intervalSec, actualSeconds: format.duration })
  }
  const flac = codec?.toUpperCase() === 'FLAC'
  if (quality === '128k' || quality === '320k') {
    if (!flac && codec && (!bitrate || (quality === '320k' ? bitrate >= 240_000 : bitrate < 240_000))) {
      if (container === 'MPEG') return { contentType: 'audio/mpeg' }
      if (codec.includes('AAC')) return { contentType: container?.includes('M4A') ? 'audio/mp4' : 'audio/aac' }
      if (container === 'Ogg') return { contentType: 'audio/ogg' }
    }
    throw mismatch('实际编码或码率与所选档位不符')
  }

  if (quality === 'atmos' && codec && /e-ac-?3|eac3|dolby digital plus/i.test(codec)) return { contentType: 'audio/eac3' }
  if (!flac) throw mismatch('未识别到无损音频')
  if ((quality === 'flac24bit' || quality === 'master') && (bitsPerSample ?? 0) < 24) {
    throw mismatch('实际位深低于 24 bit')
  }
  if (quality === 'atmos_plus' && (numberOfChannels ?? 0) < 6) throw mismatch('未识别到六声道音频')
  if (quality === 'master' && (sampleRate ?? 0) < 88_200) throw mismatch('未识别到高采样率母带')
  if (quality !== 'atmos_plus' && quality !== 'atmos' && (numberOfChannels ?? 2) > 2) throw mismatch('选定档位需要立体声音频')
  return { contentType: 'audio/flac', audioSpec: formatFlacSpec(data) }
}

interface MusicAudioRequest {
  musicInfo: MusicInfo
  quality: QualityType
  surround?: boolean
  exact?: boolean
  rangeHeader: string | null
  isHead: boolean
  requestId?: string
}

export async function serveMusicAudio(request: MusicAudioRequest): Promise<Response> {
  const { musicInfo, quality, surround, exact, rangeHeader, isHead } = request
  const requestId = request.requestId ?? randomUUID()
  const index = QUALITY_ORDER.indexOf(quality)
  const stereo = exact || index < 0 ? [quality] : QUALITY_ORDER.slice(index)
  const candidates = surround && !exact && index >= 0 ? ['atmos_plus' as const, ...stereo] : stereo
  const trackKey = getMusicAudioTrackKey(musicInfo)
  const cacheKeyPrefix = getMusicAudioCacheKeyPrefix(trackKey)
  const fallbackKey = `audio-selection:${trackKey}:${quality}:${Boolean(surround)}`
  const pinned = !exact && (rangeHeader || isHead) ? urlCache.get(fallbackKey) : null
  const selected = isQuality(pinned) && candidates.includes(pinned) ? [pinned] : candidates
  const signal = AbortSignal.timeout(PLAYBACK_BUDGET_MS)
  const intervalSec = parseIntervalToSeconds(musicInfo.interval)
  const context = { requestId, track: trackKey, requestedQuality: quality, surround: Boolean(surround), exact: Boolean(exact),
    method: isHead ? 'HEAD' : 'GET', range: Boolean(rangeHeader) }
  const attempts: Array<{ quality: QualityType; status: number; code: string }> = []

  await audioServe.ensureInitialized()
  for (const candidate of selected) {
    if (signal.aborted) break
    const upstreamUrlResolver = async (): Promise<AudioUpstream> => {
      let media: Omit<AudioUpstream, 'url'> | undefined
      const resolved = await musicSourceManager.resolveMusicUrl(musicInfo, [candidate], async ({ url }) => {
        media = await verifyMusicAudio(url, candidate, signal, intervalSec)
      }, signal, ...(request.requestId ? [requestId] as const : []))
      if (!media) throw new Error('音频规格未确认')
      return { url: resolved.url, ...media }
    }
    const response = await audioServe.serve({
      cacheKey: `${cacheKeyPrefix}${candidate}`,
      upstreamUrlResolver,
      rangeHeader,
      isHead,
      intervalSec,
      onCached: () => cacheNativeLyricForMusic(musicInfo),
    }).catch((error: unknown) => {
      const code = error instanceof PlaybackError ? error.code : 'AUDIO_STREAM_FAILED'
      logger.warn('[playback] 音频流异常', { ...context, quality: candidate, code, ...describePlaybackError(error) })
      return new Response(null, { status: 502, headers: { [PLAYBACK_ERROR_HEADER]: code } })
    })
    response.headers.set(PLAYBACK_REQUEST_ID_HEADER, requestId)
    if (response.ok) {
      if (!exact) urlCache.set(fallbackKey, candidate, FALLBACK_TTL_MS)
      response.headers.set(PLAYBACK_QUALITY_HEADER, candidate)
      // 偏好地址可在上游恢复后命中另一份文件，实际版本地址才能复用 HTTP 缓存。
      if (!exact) response.headers.set('Cache-Control', 'no-store')
      return response
    }
    const code = response.headers.get(PLAYBACK_ERROR_HEADER) ?? 'AUDIO_STREAM_HTTP'
    attempts.push({ quality: candidate, status: response.status, code })
    if (response.status !== 502 && response.status !== 403 && response.status !== 404) {
      logger.warn('[playback] 音频请求失败', { ...context, attempts })
      response.headers.set(PLAYBACK_ERROR_HEADER, code)
      return response
    }
    void response.body?.cancel().catch(() => {})
  }
  const status = attempts.at(-1)?.status ?? 502
  logger.warn('[playback] 音质候选均不可用', { ...context, attempts, timedOut: signal.aborted })
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    [PLAYBACK_REQUEST_ID_HEADER]: requestId,
    [PLAYBACK_ERROR_HEADER]: PLAYBACK_CANDIDATES_FAILED,
    [PLAYBACK_ATTEMPTS_HEADER]: JSON.stringify(attempts),
  }
  const error = { code: PLAYBACK_CANDIDATES_FAILED, message: '所选音质暂不可用', requestId, attempts }
  return new Response(isHead ? null : JSON.stringify({ success: false, error }), { status, headers })
}
