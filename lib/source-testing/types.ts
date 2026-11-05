import type { MusicInfo, QualityType, SourceConfig, SourceType } from '@/lib/types/music'

export const TEST_PLATFORMS = ['tx', 'wy', 'kw', 'kg', 'mg'] as const
export const TEST_QUALITIES: QualityType[] = ['flac24bit', 'flac', '320k', '128k']
export const PLATFORM_NAMES: Record<SourceType, string> = { tx: '腾讯', wy: '网易', kw: '酷我', kg: '酷狗', mg: '咪咕' }
export type TestSamples = Partial<Record<SourceType, MusicInfo>>
export type TestCapability = Partial<Record<SourceType, QualityType[]>>
export interface AudioFacts {
  codec: string | null; duration: number | null; sampleRate: number | null
  bitsPerSample: number | null; bitrate: number | null; lossless: boolean | null; channels: number | null
}
export interface SourceTestResult {
  key: string; platform: SourceType; quality: QualityType; song: MusicInfo
  status: 'waiting' | 'running' | 'passed' | 'warning' | 'failed' | 'cancelled'
  message: string; facts?: AudioFacts; expectedSec?: number; bytes?: number
  complete?: boolean; asset?: boolean; elapsedMs?: number; testedAt?: string
  mode: 'quick' | 'full'
}
export interface SourceTestDraft {
  id: string; kind: 'upload' | 'subscription' | 'update' | 'retest'; name: string
  hash: string; capabilities: TestCapability; target?: SourceConfig; unchanged?: boolean
  status: 'ready' | 'running' | 'completed' | 'cancelled' | 'interrupted' | 'committed'
  results: SourceTestResult[]; samplesHash?: string; samplesChanged?: boolean
  createdAt: string; expiresAt: string; committedSource?: SourceConfig
  persisted?: boolean; startedAt?: string
  previousReport?: { hash: string; capabilities: TestCapability; results: SourceTestResult[]; createdAt: string }
}

/** Persist only the known LX song fields, never client-provided URLs or object prototypes. */
export function parseTestSamples(value: unknown): TestSamples {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('测试歌曲格式无效')
  const parsed: TestSamples = {}
  for (const [platform, raw] of Object.entries(value)) {
    if (!TEST_PLATFORMS.includes(platform as SourceType)) throw new Error('无效的平台')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('测试歌曲格式无效')
    const input = raw as Record<string, unknown>
    const songmid = typeof input.songmid === 'number' && Number.isSafeInteger(input.songmid) ? String(input.songmid) : input.songmid
    if (input.source !== platform || typeof songmid !== 'string' || !songmid ||
      typeof input.name !== 'string' || !input.name || typeof input.singer !== 'string' || typeof input.interval !== 'string') throw new Error('歌曲缺少平台、标识或时长信息')
    const song: MusicInfo = { name: input.name.slice(0, 300), singer: input.singer.slice(0, 300), source: platform as SourceType,
      songmid: songmid.slice(0, 256), interval: input.interval.slice(0, 32), types: [], _types: {} as MusicInfo['_types'], typeUrl: {} }
    for (const key of ['albumId', 'albumName', 'hash', 'copyrightId', 'songId', 'strMediaMid', 'albumMid', 'albumAudioId'] as const) {
      const item = input[key]
      if (typeof item === 'string' || typeof item === 'number') Object.assign(song, { [key]: String(item).slice(0, 512) })
    }
    const types = input._types && typeof input._types === 'object' ? input._types as Record<string, unknown> : {}
    for (const quality of TEST_QUALITIES) {
      if (Object.hasOwn(types, quality)) {
        const info = types[quality] as { hash?: unknown; size?: unknown } | null
        const entry = { type: quality, size: typeof info?.size === 'string' ? info.size.slice(0, 64) : '',
          ...(typeof info?.hash === 'string' ? { hash: info.hash.slice(0, 256) } : {}) }
        song.types.push(entry); song._types[quality] = entry
      }
    }
    parsed[platform as SourceType] = song
  }
  return parsed
}

export function intervalSeconds(value: string): number {
  const parts = value.split(':').map(Number)
  const seconds = parts.reduce((total, part) => total * 60 + part, 0)
  return parts.every(Number.isFinite) && seconds > 0 ? seconds : 0
}
