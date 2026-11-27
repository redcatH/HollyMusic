import { parseBuffer } from 'music-metadata'
import { audioServe, type AudioUpstream } from '@/lib/audio-serve'
import { isIncompleteTrial } from '@/lib/audio-integrity'
import { urlCache } from '@/lib/cache-manager'
import { getStorageSongmidForMusicInfo } from '@/lib/db'
import { musicSourceManager } from '@/lib/music-source-manager'
import { PLAYBACK_QUALITY_HEADER } from '@/lib/playback-protocol'
import { QUALITY_ORDER, isQuality } from '@/lib/quality-options'
import { buildUpstreamHeaders } from '@/lib/server/download-utils'
import { formatFlacSpec } from '@/lib/server/flac-info'
import { cacheNativeLyricForMusic } from '@/lib/services/lyrics'
import { publicRequest } from '@/lib/source-testing/network.cjs'
import type { MusicInfo, QualityType } from '@/lib/types/music'
import { parseIntervalToSeconds } from '@/lib/types/player'

const PROBE_BYTES = 128 * 1024
const FALLBACK_TTL_MS = 2 * 60_000
const PLAYBACK_BUDGET_MS = 24_000

export async function verifyMusicAudio(url: string, quality: QualityType, signal?: AbortSignal, intervalSec = 0): Promise<Omit<AudioUpstream, 'url'>> {
  const { status, data, headers } = await publicRequest(url, {
    maxBytes: PROBE_BYTES,
    partial: true,
    timeout: 4_500,
    signal,
    headers: { ...buildUpstreamHeaders(url), Range: `bytes=0-${PROBE_BYTES - 1}` },
  })
  if (status !== 200 && status !== 206) throw new Error('上游音频不可用')

  const size = Number(/\/(\d+)$/.exec(String(headers['content-range'] ?? ''))?.[1] ?? headers['content-length'])
  const { format } = await parseBuffer(data, Number.isSafeInteger(size) && size > 0 ? { size } : undefined, { duration: false, skipCovers: true })
  const { codec, container, sampleRate, bitsPerSample, numberOfChannels, bitrate } = format
  if (format.duration && intervalSec && isIncompleteTrial(format.duration, intervalSec)) throw new Error('上游返回试听片段')
  const flac = codec?.toUpperCase() === 'FLAC'
  if (quality === '128k' || quality === '320k') {
    if (!flac && codec && (!bitrate || (quality === '320k' ? bitrate >= 240_000 : bitrate < 240_000))) {
      if (container === 'MPEG') return { contentType: 'audio/mpeg' }
      if (codec.includes('AAC')) return { contentType: container?.includes('M4A') ? 'audio/mp4' : 'audio/aac' }
      if (container === 'Ogg') return { contentType: 'audio/ogg' }
    }
    throw new Error('实际编码或码率与所选档位不符')
  }

  if (quality === 'atmos' && codec && /e-ac-?3|eac3|dolby digital plus/i.test(codec)) return { contentType: 'audio/eac3' }
  if (!flac) throw new Error('未识别到无损音频')
  if ((quality === 'flac24bit' || quality === 'master') && (bitsPerSample ?? 0) < 24) {
    throw new Error('实际位深低于 24 bit')
  }
  if (quality === 'atmos_plus' && (numberOfChannels ?? 0) < 6) throw new Error('未识别到六声道音频')
  if (quality === 'master' && (sampleRate ?? 0) < 88_200) throw new Error('未识别到高采样率母带')
  if (quality !== 'atmos_plus' && quality !== 'atmos' && (numberOfChannels ?? 2) > 2) throw new Error('选定档位需要立体声音频')
  return { contentType: 'audio/flac', audioSpec: formatFlacSpec(data) }
}

interface MusicAudioRequest {
  musicInfo: MusicInfo
  quality: QualityType
  surround?: boolean
  exact?: boolean
  rangeHeader: string | null
  isHead: boolean
}

export async function serveMusicAudio(request: MusicAudioRequest): Promise<Response> {
  const { musicInfo, quality, surround, exact, rangeHeader, isHead } = request
  const index = QUALITY_ORDER.indexOf(quality)
  const stereo = exact || index < 0 ? [quality] : QUALITY_ORDER.slice(index)
  const candidates = surround && !exact && index >= 0 ? ['atmos_plus' as const, ...stereo] : stereo
  const trackKey = `${musicInfo.source}:${getStorageSongmidForMusicInfo(musicInfo)}`
  const fallbackKey = `audio-selection:${trackKey}:${quality}:${Boolean(surround)}`
  const pinned = !exact && (rangeHeader || isHead) ? urlCache.get(fallbackKey) : null
  const selected = isQuality(pinned) && candidates.includes(pinned) ? [pinned] : candidates
  const signal = AbortSignal.timeout(PLAYBACK_BUDGET_MS)
  const intervalSec = parseIntervalToSeconds(musicInfo.interval)
  let failure: Response | undefined

  await audioServe.ensureInitialized()
  for (const candidate of selected) {
    if (signal.aborted) break
    const upstreamUrlResolver = async (): Promise<AudioUpstream> => {
      let media: Omit<AudioUpstream, 'url'> | undefined
      const resolved = await musicSourceManager.resolveMusicUrl(musicInfo, [candidate], async ({ url }) => {
        media = await verifyMusicAudio(url, candidate, signal, intervalSec)
      }, signal)
      if (!media) throw new Error('音频规格未确认')
      return { url: resolved.url, ...media }
    }
    const response = await audioServe.serve({
      cacheKey: `audio-v2:${trackKey}:${candidate}`,
      upstreamUrlResolver,
      rangeHeader,
      isHead,
      intervalSec,
      onCached: () => cacheNativeLyricForMusic(musicInfo),
    }).catch(() => new Response(null, { status: 502 }))
    if (response.ok) {
      if (!exact) urlCache.set(fallbackKey, candidate, FALLBACK_TTL_MS)
      response.headers.set(PLAYBACK_QUALITY_HEADER, candidate)
      // 偏好地址可在上游恢复后命中另一份文件，实际版本地址才能复用 HTTP 缓存。
      if (!exact) response.headers.set('Cache-Control', 'no-store')
      return response
    }
    if (response.status !== 502 && response.status !== 403 && response.status !== 404) return response
    if (failure) void failure.body?.cancel().catch(() => {})
    failure = response
  }
  return failure ?? Response.json({ error: '所选音质暂不可用' }, { status: 502 })
}
