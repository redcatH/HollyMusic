import { createBrowserStorage, isRecord, readStorageValue, type StorageArea } from '@/lib/browser-storage'
import { VALID_QUALITIES } from '@/lib/quality-options'
import type { MusicInfo, QualityInfo, QualityType, SourceType } from '@/lib/types/music'
import { toTrack, type PlaybackMode, type Track } from '@/lib/types/player'

export interface PlayerPreferences {
  volume: number
  isMuted: boolean
  playbackMode: PlaybackMode
  quality: QualityType
}

export interface PlaybackSession {
  queue: Track[]
  playNextQueue: Track[]
  currentIndex: number
  currentTrack: Track | null
  isCurrentTempPlay: boolean
  currentTime: number
}

export interface PlayerTabState {
  sleepTimer: { minutes: number; expiresAt: number } | null
  isQueueOpen: boolean
  isLyricsOpen: boolean
}

export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  volume: 0.8, isMuted: false, playbackMode: 'sequence', quality: '320k',
}
export const PLAYER_PREFERENCES_KEY = 'holly-player-preferences'
const LEGACY_QUALITY_KEY = 'player:quality'
const SOURCES: SourceType[] = ['kw', 'kg', 'tx', 'wy', 'mg']

function isQuality(value: unknown): value is QualityType {
  return typeof value === 'string' && VALID_QUALITIES.includes(value as QualityType)
}

function parsePreferences(value: unknown): PlayerPreferences | null {
  if (!isRecord(value)) return null
  return {
    volume: typeof value.volume === 'number' && Number.isFinite(value.volume)
      ? Math.max(0, Math.min(1, value.volume)) : DEFAULT_PLAYER_PREFERENCES.volume,
    isMuted: typeof value.isMuted === 'boolean' ? value.isMuted : false,
    playbackMode: value.playbackMode === 'loop' || value.playbackMode === 'random' ? value.playbackMode : 'sequence',
    quality: isQuality(value.quality) ? value.quality : DEFAULT_PLAYER_PREFERENCES.quality,
  }
}

export const playerPreferencesStorage = createBrowserStorage(PLAYER_PREFERENCES_KEY, parsePreferences)

export function loadPlayerPreferences(): PlayerPreferences {
  const stored = playerPreferencesStorage.read()
  if (stored) return stored
  const legacy = readStorageValue(LEGACY_QUALITY_KEY)
  const preferences = { ...DEFAULT_PLAYER_PREFERENCES, ...(isQuality(legacy) ? { quality: legacy } : {}) }
  if (isQuality(legacy) && playerPreferencesStorage.write(preferences)) {
    createBrowserStorage(LEGACY_QUALITY_KEY, () => null).remove()
  }
  return preferences
}

/** 重新构造已知字段，避免旧版本或损坏数据进入播放器；保留音源必需的元数据。 */
function parseTrack(value: unknown): Track | null {
  if (!isRecord(value) || typeof value.uid !== 'string' || !value.uid || !isRecord(value.musicInfo)) return null
  const info = value.musicInfo
  if (typeof info.source !== 'string' || !SOURCES.includes(info.source as SourceType)
    || !value.uid.startsWith(`${info.source}-`) || typeof info.songmid !== 'string' || !info.songmid
    || typeof info.name !== 'string' || typeof info.singer !== 'string') return null
  const types: QualityInfo[] = []
  for (const item of Array.isArray(info.types) ? info.types : []) {
    if (!isRecord(item) || !isQuality(item.type)) continue
    types.push({ type: item.type, size: typeof item.size === 'string' ? item.size : '',
      ...(typeof item.hash === 'string' ? { hash: item.hash } : {}) })
  }
  const musicInfo: MusicInfo = {
    name: info.name, singer: info.singer, source: info.source as SourceType, songmid: info.songmid,
    interval: typeof info.interval === 'string' ? info.interval : typeof info.interval === 'number' && Number.isFinite(info.interval) ? String(info.interval) : '',
    types, _types: {} as MusicInfo['_types'], typeUrl: {},
  }
  for (const quality of VALID_QUALITIES) {
    const details = isRecord(info._types) ? info._types[quality] : null
    if (isRecord(details)) musicInfo._types[quality] = {
      type: quality,
      ...(typeof details.size === 'string' ? { size: details.size } : {}),
      ...(typeof details.hash === 'string' ? { hash: details.hash } : {}),
    }
  }
  for (const key of ['albumId', 'albumName', 'img', 'hash', 'copyrightId', 'strMediaMid', 'albumMid', 'lrc', 'lrcUrl', 'mrcUrl', 'trcUrl'] as const) {
    if (typeof info[key] === 'string') musicInfo[key] = info[key]
  }
  if (typeof info.songId === 'string' || (typeof info.songId === 'number' && Number.isFinite(info.songId))) musicInfo.songId = info.songId
  const track = toTrack({ uid: value.uid, musicInfo })
  track.duration = typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0
    ? value.duration : Number.isFinite(track.duration) && track.duration > 0 ? track.duration : 0
  return track
}

function parseSession(value: unknown): PlaybackSession | null {
  if (!isRecord(value) || !Array.isArray(value.queue) || !Array.isArray(value.playNextQueue)) return null
  const queue = value.queue.map(parseTrack)
  const playNextQueue = value.playNextQueue.map(parseTrack)
  // 不能过滤坏条目再沿用旧索引，否则会恢复到另一首歌。
  if (queue.some(track => !track) || playNextQueue.some(track => !track)) return null
  const currentTrack = value.currentTrack === null ? null : parseTrack(value.currentTrack)
  if (value.currentTrack !== null && !currentTrack) return null
  const currentIndex = typeof value.currentIndex === 'number' && Number.isInteger(value.currentIndex)
    && value.currentIndex >= -1 && value.currentIndex < queue.length ? value.currentIndex : -1
  const isCurrentTempPlay = value.isCurrentTempPlay === true
  if (currentTrack && !isCurrentTempPlay && queue[currentIndex]?.uid !== currentTrack.uid) return null
  const currentTime = currentTrack && typeof value.currentTime === 'number' && Number.isFinite(value.currentTime)
    ? Math.max(0, value.currentTime) : 0
  return {
    queue: queue as Track[], playNextQueue: playNextQueue as Track[], currentIndex, currentTrack, isCurrentTempPlay,
    currentTime: currentTrack && currentTrack.duration > 0 ? Math.min(currentTime, currentTrack.duration) : currentTime,
  }
}

function parseTabState(value: unknown): PlayerTabState | null {
  if (!isRecord(value)) return null
  const timer = value.sleepTimer
  const sleepTimer = isRecord(timer) && typeof timer.minutes === 'number' && [15, 30, 45, 60].includes(timer.minutes)
    && typeof timer.expiresAt === 'number' && Number.isFinite(timer.expiresAt)
    && timer.expiresAt > Date.now() && timer.expiresAt <= Date.now() + 60 * 60_000
    ? { minutes: timer.minutes, expiresAt: timer.expiresAt } : null
  return { sleepTimer, isQueueOpen: value.isQueueOpen === true, isLyricsOpen: value.isLyricsOpen === true }
}

export function playbackSessionStorage(username: string, area: StorageArea = 'local') {
  return createBrowserStorage(`holly-player-session:${encodeURIComponent(username)}`, parseSession, area)
}

export function playerTabStorage(username: string) {
  return createBrowserStorage(`holly-player-tab:${encodeURIComponent(username)}`, parseTabState, 'session')
}
