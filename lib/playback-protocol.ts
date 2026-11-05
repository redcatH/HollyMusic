import type { QualityType } from '@/lib/types/music'
import { isAudioDurationValid } from './audio-integrity'

/** 页面和 classic SW 共用的通信契约；仅依赖纯规则，构建时编译进 Worker。 */
export const PLAYBACK_PROTOCOL_VERSION = 1
export const PLAYBACK_MANIFEST_VERSION = 1
export const PLAYBACK_CHUNK_BYTES = 256 * 1024
export const PLAYBACK_DATA_CACHE = 'holly-playback-data-v1'
export const PLAYBACK_SESSIONS_CACHE = 'holly-playback-sessions-v1'
export const OFFLINE_AUDIO_CACHE_PREFIX = 'holly-audio-v1:'
export const PLAYBACK_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'] as const satisfies readonly QualityType[]
export const PLAYBACK_MESSAGE = {
  CAPTURE: 'holly-capture-audio', RELEASE: 'holly-release-audio', CACHED_AUDIO: 'holly-cached-audio',
  PRUNE: 'holly-prune-audio', DIAGNOSTIC: 'holly-sw-diagnostic',
  READY: 'ready', COMPLETE: 'complete', UNAVAILABLE: 'unavailable',
  CACHED: 'cached', CANCEL: 'cancel', CANCEL_CACHE: 'cancel-cache',
} as const

interface VersionedMessage { protocolVersion?: number }
export type PlaybackWorkerCommand = VersionedMessage & (
  | { type: typeof PLAYBACK_MESSAGE.PRUNE }
  | { type: typeof PLAYBACK_MESSAGE.CAPTURE; url: string; limit: number; captureId?: string; cacheName?: string; cacheKey?: string }
  | { type: typeof PLAYBACK_MESSAGE.RELEASE; url: string; captureId: string; preservePlayback?: boolean }
  | { type: typeof PLAYBACK_MESSAGE.CACHED_AUDIO; url: string; captureId: string }
)
export type PlaybackPortCommand = { type: typeof PLAYBACK_MESSAGE.CANCEL | typeof PLAYBACK_MESSAGE.CANCEL_CACHE | typeof PLAYBACK_MESSAGE.CACHED }
export type PlaybackWorkerReply = VersionedMessage & (
  | { type: typeof PLAYBACK_MESSAGE.READY | typeof PLAYBACK_MESSAGE.UNAVAILABLE }
  | { type: typeof PLAYBACK_MESSAGE.COMPLETE; cacheName: string; cacheKey: string }
  | { type: typeof PLAYBACK_MESSAGE.COMPLETE; blob: Blob; headers?: Record<string, string> }
)
export interface PlaybackDiagnostic {
  type: typeof PLAYBACK_MESSAGE.DIAGNOSTIC
  operation: string
  name: string
  message: string
}
export interface PlaybackChunk { key: string; length: number }
export interface PlaybackManifest {
  version: number
  size: number
  headers: Record<string, string>
  chunks: PlaybackChunk[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isHeaders(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string')
}
function hasVersion(value: Record<string, unknown>): boolean {
  return value.protocolVersion === undefined || (typeof value.protocolVersion === 'number' && Number.isSafeInteger(value.protocolVersion))
}
/** 未带版本号的是本协议引入前的 v1。显式未知版本必须回退，不能按当前格式猜测。 */
export function isCompatiblePlaybackVersion(version: unknown): boolean {
  return version === undefined || version === PLAYBACK_PROTOCOL_VERSION
}

export function isPlaybackWorkerCommand(value: unknown): value is PlaybackWorkerCommand {
  if (!isRecord(value) || !hasVersion(value)) return false
  if (value.type === PLAYBACK_MESSAGE.PRUNE) return true
  if (typeof value.url !== 'string') return false
  if (value.type === PLAYBACK_MESSAGE.CAPTURE) {
    return typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit > 0
      && ['captureId', 'cacheName', 'cacheKey'].every(key => value[key] === undefined || typeof value[key] === 'string')
  }
  if (typeof value.captureId !== 'string' || !value.captureId) return false
  return value.type === PLAYBACK_MESSAGE.CACHED_AUDIO || (value.type === PLAYBACK_MESSAGE.RELEASE
    && (value.preservePlayback === undefined || typeof value.preservePlayback === 'boolean'))
}
export function isPlaybackPortCommand(value: unknown): value is PlaybackPortCommand {
  return isRecord(value) && (value.type === PLAYBACK_MESSAGE.CANCEL || value.type === PLAYBACK_MESSAGE.CANCEL_CACHE
    || value.type === PLAYBACK_MESSAGE.CACHED)
}
export function isPlaybackWorkerReply(value: unknown): value is PlaybackWorkerReply {
  if (!isRecord(value) || !hasVersion(value)) return false
  if (value.type === PLAYBACK_MESSAGE.READY || value.type === PLAYBACK_MESSAGE.UNAVAILABLE) return true
  if (value.type !== PLAYBACK_MESSAGE.COMPLETE) return false
  if (typeof value.cacheName === 'string' && typeof value.cacheKey === 'string') return true
  return typeof Blob !== 'undefined' && value.blob instanceof Blob && (value.headers === undefined || isHeaders(value.headers))
}
export function isPlaybackDiagnostic(value: unknown): value is PlaybackDiagnostic {
  return isRecord(value) && value.type === PLAYBACK_MESSAGE.DIAGNOSTIC && typeof value.operation === 'string'
    && typeof value.name === 'string' && typeof value.message === 'string'
}

export function offlineAudioCacheName(username: string): string {
  return OFFLINE_AUDIO_CACHE_PREFIX + encodeURIComponent(username)
}
export function offlineAudioCacheKey(uid: string, quality: string, origin: string): string {
  return new URL(`/__offline_audio/${encodeURIComponent(uid)}/${quality}`, origin).href
}
export function playbackDataKey(clientId: string, captureId: string, part: string | number, origin: string): string {
  return new URL(`/__playback_data/${encodeURIComponent(clientId)}/${encodeURIComponent(captureId)}/${part}`, origin).href
}
export function playbackSessionKey(clientId: string, url: string, origin: string): string {
  return new URL(`/__playback_session/${encodeURIComponent(clientId)}/${encodeURIComponent(url)}`, origin).href
}
export function isPlaybackSession(value: unknown, url: URL): boolean {
  if (!isRecord(value)) return false
  const uid = url.searchParams.get('uid')
  const quality = url.searchParams.get('quality') || '320k'
  return typeof value.captureId === 'string' && value.captureId.length > 0
    && typeof value.cacheName === 'string' && value.cacheName.startsWith(OFFLINE_AUDIO_CACHE_PREFIX)
    && !!uid && PLAYBACK_QUALITIES.some(item => item === quality)
    && value.cacheKey === offlineAudioCacheKey(uid, quality, url.origin)
}
export function isPlaybackDataLocation(key: string, captureId: string, origin: string): boolean {
  try {
    const url = new URL(key)
    const parts = url.pathname.split('/')
    return url.origin === origin && !url.search && !url.hash && parts.length === 5
      && parts[1] === '__playback_data' && !!parts[2] && parts[3] === encodeURIComponent(captureId) && parts[4] === 'complete'
  } catch { return false }
}

export function createPlaybackManifest(size: number, headers: Record<string, string>, chunks: PlaybackChunk[]): PlaybackManifest {
  return { version: PLAYBACK_MANIFEST_VERSION, size, headers, chunks }
}
export function parsePlaybackManifest(value: unknown, key: string, captureId: string, limit: number): PlaybackManifest {
  if (!isRecord(value) || value.version !== PLAYBACK_MANIFEST_VERSION || typeof value.size !== 'number'
    || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > limit || !isHeaders(value.headers)
    || value.headers['content-length'] !== String(value.size) || !Array.isArray(value.chunks)) {
    throw new Error('播放缓存清单格式或大小无效')
  }
  const base = key.slice(0, -'complete'.length)
  let total = 0
  const chunks: PlaybackChunk[] = []
  for (const [index, chunk] of value.chunks.entries()) {
    if (!isRecord(chunk) || chunk.key !== `${base}${index}` || !base.endsWith(`/${encodeURIComponent(captureId)}/`)
      || typeof chunk.length !== 'number' || !Number.isSafeInteger(chunk.length) || chunk.length <= 0 || chunk.length > PLAYBACK_CHUNK_BYTES) {
      throw new Error('播放缓存分块清单无效')
    }
    total += chunk.length
    chunks.push({ key: chunk.key, length: chunk.length })
  }
  if (total !== value.size) throw new Error('播放缓存清单总长度不一致')
  return { version: value.version, size: value.size, headers: value.headers, chunks }
}

/** 编译器生成 classic SW 所需的单个命名空间；页面直接使用上面的类型与导出。 */
export const playbackProtocol = {
  version: PLAYBACK_PROTOCOL_VERSION, message: PLAYBACK_MESSAGE, chunkBytes: PLAYBACK_CHUNK_BYTES,
  dataCache: PLAYBACK_DATA_CACHE, sessionsCache: PLAYBACK_SESSIONS_CACHE,
  isCompatibleVersion: isCompatiblePlaybackVersion, isWorkerCommand: isPlaybackWorkerCommand,
  isPortCommand: isPlaybackPortCommand, isWorkerReply: isPlaybackWorkerReply,
  isSession: isPlaybackSession, dataKey: playbackDataKey, sessionKey: playbackSessionKey,
  createManifest: createPlaybackManifest,
  isAudioDurationValid,
}
