import { createBrowserStorage, isRecord, readStorageValue, type StorageArea } from '@/lib/browser-storage'
import { QUALITY_ORDER, VALID_QUALITIES, isQuality } from '@/lib/quality-options'
import type { MusicInfo, QualityInfo, QualityType, SourceType } from '@/lib/types/music'
import { toTrack, type PlaybackMode, type Track } from '@/lib/types/player'
import { MAX_PLAYBACK_HISTORY, projectPlaybackQueue, restoreLegacyQueue, type PlaybackQueue, type PlaybackVisit, type QueueEntry } from '@/lib/player-queue'

export interface PlayerPreferences {
  volume: number
  isMuted: boolean
  playbackMode: PlaybackMode
  quality: QualityType
  keepScreenAwake: boolean
  preferSurround?: boolean
}

export interface PlaybackSession {
  queue: Track[]
  playNextQueue: Track[]
  currentIndex: number
  currentTrack: Track | null
  isCurrentTempPlay: boolean
  currentTime: number
  navigation?: PlaybackQueue | null
}

export interface PlayerTabState {
  sleepTimer: { minutes: number; expiresAt: number } | null
  isQueueOpen: boolean
}

export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  volume: 0.8, isMuted: false, playbackMode: 'sequence', quality: '320k', keepScreenAwake: false,
}
export const PLAYER_PREFERENCES_KEY = 'holly-player-preferences'
const LEGACY_QUALITY_KEY = 'player:quality'
const SOURCES: SourceType[] = ['kw', 'kg', 'tx', 'wy', 'mg']

function parsePreferences(value: unknown): PlayerPreferences | null {
  if (!isRecord(value)) return null
  return {
    volume: typeof value.volume === 'number' && Number.isFinite(value.volume)
      ? Math.max(0, Math.min(1, value.volume)) : DEFAULT_PLAYER_PREFERENCES.volume,
    isMuted: typeof value.isMuted === 'boolean' ? value.isMuted : false,
    playbackMode: value.playbackMode === 'loop' || value.playbackMode === 'random' ? value.playbackMode : 'sequence',
    quality: isQuality(value.quality) && QUALITY_ORDER.includes(value.quality) ? value.quality : DEFAULT_PLAYER_PREFERENCES.quality,
    keepScreenAwake: value.keepScreenAwake === true,
    ...(value.preferSurround === true ? { preferSurround: true } : {}),
  }
}

export const playerPreferencesStorage = createBrowserStorage(PLAYER_PREFERENCES_KEY, parsePreferences)

export function loadPlayerPreferences(): PlayerPreferences {
  const stored = playerPreferencesStorage.read()
  if (stored) return stored
  const legacy = readStorageValue(LEGACY_QUALITY_KEY)
  const legacyQuality = isQuality(legacy) && QUALITY_ORDER.includes(legacy) ? legacy : null
  const preferences = { ...DEFAULT_PLAYER_PREFERENCES, ...(legacyQuality ? { quality: legacyQuality } : {}) }
  if (legacyQuality && playerPreferencesStorage.write(preferences)) {
    createBrowserStorage(LEGACY_QUALITY_KEY, () => null).remove()
  }
  return preferences
}

/** 重新构造已知字段，避免旧版本或损坏数据进入播放器；保留音源必需的元数据。 */
export function parseTrack(value: unknown): Track | null {
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
  if (value.playback !== undefined) {
    if (!isRecord(value.playback) || value.playback.source !== 'local' || !isQuality(value.playback.quality)) return null
    track.playback = { source: 'local', quality: value.playback.quality }
  }
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
  if (currentTrack && !isCurrentTempPlay && (queue[currentIndex]?.uid !== currentTrack.uid
    || queue[currentIndex]?.playback?.source !== currentTrack.playback?.source
    || queue[currentIndex]?.playback?.quality !== currentTrack.playback?.quality)) return null
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
  return { sleepTimer, isQueueOpen: value.isQueueOpen === true }
}

interface StoredVisit { id: string; mainId: string | null; started: boolean }
interface StoredPlaybackSession {
  catalog: QueueEntry[]
  main: string[]
  manual: string[]
  past: StoredVisit[]
  current: StoredVisit | null
  future: StoredVisit[]
  upcoming: string[]
  shuffle: boolean
  nextId: number
  currentTime: number
}

function encodeSession(navigation: PlaybackQueue, currentTime: number): StoredPlaybackSession {
  const visits = [...navigation.past, ...navigation.future, ...(navigation.current ? [navigation.current] : [])]
  const catalog = new Map([...navigation.entries, ...navigation.manual, ...visits.map(visit => visit.entry)].map(entry => [entry.id, entry]))
  const visit = (item: PlaybackVisit): StoredVisit => ({ id: item.entry.id, mainId: item.mainId, started: item.started })
  return {
    catalog: [...catalog.values()], main: navigation.entries.map(entry => entry.id), manual: navigation.manual.map(entry => entry.id),
    past: navigation.past.map(visit), current: navigation.current ? visit(navigation.current) : null,
    future: navigation.future.map(visit), upcoming: navigation.upcoming, shuffle: navigation.shuffle, nextId: navigation.nextId, currentTime,
  }
}

/** 持久化按入队 ID 引用曲目，避免每次后退/重播都复制整份歌曲数据。 */
function parseStoredSession(value: unknown): StoredPlaybackSession | null {
  if (!isRecord(value) || !Array.isArray(value.catalog) || typeof value.shuffle !== 'boolean'
    || typeof value.nextId !== 'number' || !Number.isSafeInteger(value.nextId) || value.nextId < 1) return null
  const catalog = new Map<string, QueueEntry>()
  for (const item of value.catalog) {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[1-9]\d*$/.test(item.id)
      || Number(item.id) >= value.nextId || catalog.has(item.id)) return null
    const track = parseTrack(item.track)
    if (!track) return null
    catalog.set(item.id, { id: item.id, track })
  }
  const ids = (items: unknown, allowed: Set<string>): string[] | null => {
    if (!Array.isArray(items) || items.some(id => typeof id !== 'string' || !allowed.has(id)) || new Set(items).size !== items.length) return null
    return items
  }
  const main = ids(value.main, new Set(catalog.keys()))
  const manual = ids(value.manual, new Set(catalog.keys()))
  if (!main || !manual || manual.some(id => main.includes(id))) return null
  const mainIds = new Set(main)
  const pendingIds = new Set(manual)
  const upcoming = ids(value.upcoming, mainIds)
  if (!upcoming) return null
  const visit = (item: unknown): StoredVisit | null => {
    if (!isRecord(item) || typeof item.id !== 'string' || !catalog.has(item.id) || pendingIds.has(item.id)
      || (item.mainId !== null && (typeof item.mainId !== 'string' || !mainIds.has(item.mainId)))
      || (mainIds.has(item.id) && item.mainId !== item.id) || typeof item.started !== 'boolean') return null
    return { id: item.id, mainId: item.mainId as string | null, started: item.started }
  }
  if (!Array.isArray(value.past) || !Array.isArray(value.future)
    || value.past.length + value.future.length > MAX_PLAYBACK_HISTORY) return null
  const past = value.past.map(visit)
  const future = value.future.map(visit)
  if ([...past, ...future].some(item => !item?.started)) return null
  const current = value.current === null ? null : visit(value.current)
  if (value.current !== null && !current) return null
  const duration = current ? catalog.get(current.id)!.track.duration : 0
  const time = current && typeof value.currentTime === 'number' && Number.isFinite(value.currentTime) ? Math.max(0, value.currentTime) : 0
  return { catalog: [...catalog.values()], main, manual, past: past as StoredVisit[], future: future as StoredVisit[], current,
    upcoming, shuffle: value.shuffle, nextId: value.nextId, currentTime: duration > 0 ? Math.min(time, duration) : time }
}

export function playbackSessionStorage(username: string, area: StorageArea = 'local') {
  const key = `holly-player-session:${encodeURIComponent(username)}`
  const storage = createBrowserStorage(key, parseStoredSession, area, 2)
  const legacy = createBrowserStorage(key, parseSession, area)
  return {
    key,
    read(): PlaybackSession | null {
      const stored = storage.read()
      if (!stored) return legacy.read()
      const catalog = new Map(stored.catalog.map(entry => [entry.id, entry]))
      const visit = (item: StoredVisit): PlaybackVisit => ({ entry: catalog.get(item.id)!, mainId: item.mainId, started: item.started })
      const navigation: PlaybackQueue = {
        entries: stored.main.map(id => catalog.get(id)!), manual: stored.manual.map(id => catalog.get(id)!),
        past: stored.past.map(visit), current: stored.current ? visit(stored.current) : null, future: stored.future.map(visit),
        upcoming: stored.upcoming, shuffle: stored.shuffle, nextId: stored.nextId,
      }
      return { ...projectPlaybackQueue(navigation), currentTime: stored.currentTime }
    },
    write(session: PlaybackSession): boolean {
      const validated = session.navigation ? session : parseSession(session)
      if (!validated) return false
      const navigation = validated.navigation ?? restoreLegacyQueue(validated, loadPlayerPreferences().playbackMode)
      return storage.write(encodeSession(navigation, session.currentTime))
    },
    remove: storage.remove,
  }
}

export function playerTabStorage(username: string) {
  return createBrowserStorage(`holly-player-tab:${encodeURIComponent(username)}`, parseTabState, 'session')
}
