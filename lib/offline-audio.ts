import { buildAudioUrl } from '@/lib/api/music'
import { createBrowserStorage, isCacheStorageAvailable as isOfflineStorageAvailable } from '@/lib/browser-storage'
import { parseTrack } from '@/lib/player-storage'
import { VALID_QUALITIES } from '@/lib/quality-options'
import { logger } from '@/lib/logger'
import { cancelPlaybackResponses, getPlaybackResponseReader, markPlaybackCached } from '@/lib/playback-response'
import { getOfflineAudioCacheName as cacheName, getOfflineAudioCacheKey as audioKey } from '@/lib/offline-audio-keys'
import { isAudioDurationValid, isIncompleteTrial } from '@/lib/audio-integrity'
import { readAudioDuration } from '@/lib/client/audio-duration'
import type { Track } from '@/lib/types/player'
import type { QualityType } from '@/lib/types/music'

export const OFFLINE_CHANGED = 'holly-offline-changed'
export const CACHE_MB = 1_000_000
export const OFFLINE_MIN_LIMIT_BYTES = 100 * CACHE_MB
export const OFFLINE_DEFAULT_LIMIT_BYTES = 500 * CACHE_MB

// 仅作为本机离线资料的入口，不作为服务端登录凭据。
export const offlineIdentity = createBrowserStorage<string>('holly-offline-user', value =>
  typeof value === 'string' && value.length > 0 ? value : null)

export interface OfflineTrack {
  track: Track
  quality: QualityType
  size: number
  usedAt: number
  key: string
}

export interface OfflineCleanupPlan {
  entries: OfflineTrack[]
  bytes: number
}

function validLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= OFFLINE_MIN_LIMIT_BYTES
}

function limitStorage(username: string) {
  return createBrowserStorage<number>(`holly-offline-limit:${encodeURIComponent(username)}`, value => validLimit(value) ? value : null)
}

export function getOfflineCacheLimit(username: string): number {
  return limitStorage(username).read() ?? OFFLINE_DEFAULT_LIMIT_BYTES
}

/** 从最久未使用的音频开始释放空间；reserveBytes 是即将写入的完整歌曲大小。 */
export function planOfflineCleanup(entries: OfflineTrack[], limit: number, reserveBytes = 0): OfflineCleanupPlan {
  const oldestFirst = [...entries].sort((a, b) => a.usedAt - b.usedAt)
  let total = entries.reduce((sum, entry) => sum + entry.size, 0) + reserveBytes
  const removed: OfflineTrack[] = []
  for (const entry of oldestFirst) {
    if (total <= limit) break
    removed.push(entry)
    total -= entry.size
  }
  return { entries: removed, bytes: removed.reduce((sum, entry) => sum + entry.size, 0) }
}

/** 需要清理时先返回计划；确认后重新核对，避免删除用户尚未确认的新条目。 */
export async function setOfflineCacheLimit(username: string, limit: number, approvedKeys?: string[]): Promise<{ saved: boolean; cleanup: OfflineCleanupPlan }> {
  if (!validLimit(limit)) throw new Error('缓存总容量不能低于 100 MB，且必须是有效大小')
  return withCacheLock(async () => {
    const cleanup = planOfflineCleanup(await listOfflineTracks(username), limit)
    const approved = new Set(approvedKeys)
    if (cleanup.entries.length && (approved.size !== cleanup.entries.length || cleanup.entries.some(entry => !approved.has(entry.key)))) {
      return { saved: false, cleanup }
    }
    if (!limitStorage(username).write(limit)) throw new Error('无法保存设置，请检查浏览器存储权限')
    cancelOfflineDownloads()
    try {
      if (cleanup.entries.length) {
        const cache = await caches.open(cacheName(username))
        for (const entry of cleanup.entries) await cache.delete(entry.key)
      }
    } finally { changed() }
    return { saved: true, cleanup }
  })
}

export { isOfflineStorageAvailable }
function changed(): void { window.dispatchEvent(new Event(OFFLINE_CHANGED)) }
function logOfflineFailure(message: string, error: unknown): void {
  logger.warn(message, { name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error) })
}
async function withCacheLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('holly-offline-audio', action) : action()
}
function metadata(response: Response, key: string): OfflineTrack | null {
  try {
    const track = parseTrack(JSON.parse(decodeURIComponent(response.headers.get('x-holly-track') || '')))
    const quality = response.headers.get('x-holly-quality') as QualityType
    const size = Number(response.headers.get('content-length'))
    const usedAt = Number(response.headers.get('x-holly-used'))
    return track && VALID_QUALITIES.includes(quality) && size > 0 && Number.isFinite(usedAt)
      ? { track, quality, size, usedAt, key } : null
  } catch { return null }
}

/** 调用方持有缓存锁；历史记录补检真实时长，确认试听后只删除这一首。 */
async function checkedCachedAudio(cache: Cache, key: string, expectedSec: number, signal?: AbortSignal): Promise<Response | null> {
  const response = await cache.match(key)
  if (!response) return null
  const savedDuration = Number(response.headers.get('x-holly-duration'))
  const duration = savedDuration > 0 && Number.isFinite(savedDuration)
    ? savedDuration : await readAudioDuration(response, signal)
  if (!response.body?.locked) void response.body?.cancel().catch(() => {})
  if (signal?.aborted) return null
  if (isIncompleteTrial(duration, expectedSec)) {
    await cache.delete(key)
    changed()
    return null
  }
  if (!isAudioDurationValid(duration, expectedSec)) return null
  const fresh = await cache.match(key)
  if (!fresh) return null
  const headers = new Headers(fresh.headers)
  if (duration > 0) headers.set('x-holly-duration', String(duration))
  headers.set('x-holly-used', String(Date.now()))
  await cache.put(key, new Response(fresh.body, { headers }))
    .catch(error => logOfflineFailure('[offline] 更新歌曲使用时间失败，不影响本地播放', error))
  return (await cache.match(key)) ?? null
}

export async function listOfflineTracks(username: string): Promise<OfflineTrack[]> {
  if (!isOfflineStorageAvailable()) return []
  const cache = await caches.open(cacheName(username))
  const result = await Promise.all((await cache.keys()).map(async request => {
    const response = await cache.match(request)
    return response ? metadata(response, request.url) : null
  }))
  return result.filter((item): item is OfflineTrack => item !== null).sort((a, b) => b.usedAt - a.usedAt)
}

// 同一页面串行下载，避免后台缓存争抢当前音频带宽。账号切换、清空时取消未完成任务。
let pending = Promise.resolve()
let generation = 0
const queued = new Map<string, number>()
const controllers = new Set<AbortController>()
let nextStagingSweep = 0

async function cleanupOldStaging(cache: Cache): Promise<void> {
  const now = Date.now()
  if (now < nextStagingSweep) return
  nextStagingSweep = now + 30 * 60_000
  for (const request of await cache.keys()) {
    const match = new URL(request.url).pathname.match(/^\/__offline_stage\/(\d+)-/)
    if (match && Number(match[1]) < now - 30 * 60_000) await cache.delete(request)
  }
}

/** Cache.put 流式消费并校验总长度；失败时原子写入不提交，不构造整首 Blob。 */
function verifiedAudioBody(response: Response, length: number, signal: AbortSignal, epoch: number): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error('音频响应缺少数据')
  const reader = response.body.getReader()
  let received = 0
  const stop = () => { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}) }
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (signal.aborted || epoch !== generation) throw new Error('缓存已取消')
        const { value, done } = await reader.read()
        if (signal.aborted || epoch !== generation) throw new Error('缓存已取消')
        if (done) {
          if (received !== length) throw new Error('音频下载不完整')
          stop()
          controller.close()
          return
        }
        received += value.byteLength
        if (received > length) throw new Error('音频超过声明大小')
        controller.enqueue(value)
      } catch (error) { stop(); controller.error(error) }
    },
    cancel: stop,
  })
}

export function cancelOfflineDownloads(): void {
  generation++
  cancelPlaybackResponses()
  controllers.forEach(controller => controller.abort())
  controllers.clear()
}

export function cachePlayedTrack(username: string, track: Track, quality: QualityType): Promise<void> {
  if (!isOfflineStorageAvailable() || !navigator.onLine) return Promise.resolve()
  const storedTrack = parseTrack(track)
  if (!storedTrack) return Promise.resolve()
  const key = audioKey(track.uid, quality)
  const job = cacheName(username) + key
  const epoch = generation
  // 同一代任务去重；已取消但尚未结束的任务不能挡住恢复联网后的重试。
  if (queued.get(job) === epoch) return pending
  queued.set(job, epoch)
  // 在排队前固定本次播放响应；之后的切歌/重播不能替换任务的数据来源。
  const readPlaybackResponse = getPlaybackResponseReader(username, buildAudioUrl(track.uid, quality))
  const playbackResponse = readPlaybackResponse?.()
  const task = async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5 * 60_000)
    controllers.add(controller)
    let staging: Cache | null = null
    let stagingKey: string | null = null
    try {
      if (epoch !== generation) return
      const cache = await caches.open(cacheName(username))
      const existing = await withCacheLock(async () => {
        if (epoch !== generation) return null
        return checkedCachedAudio(cache, key, storedTrack.duration, controller.signal)
      })
      if (existing) {
        void existing.body?.cancel().catch(() => {})
        if (epoch === generation) markPlaybackCached(username, buildAudioUrl(track.uid, quality))
        return
      }
      if (epoch !== generation || controller.signal.aborted) return
      // 不带 Range，只有 200 完整音频才入库；浏览器流缓冲不等于离线缓存。
      const response = playbackResponse
        ? await playbackResponse
        : await fetch(buildAudioUrl(track.uid, quality), { signal: controller.signal, cache: 'no-store' })
      // 已接管的播放流失败或只有局部数据时跳过缓存，不再额外下载整首。
      if (!response) return
      const type = response.headers.get('content-type') || ''
      const length = Number(response.headers.get('content-length'))
      if (response.status !== 200 || !/^(audio\/|application\/octet-stream)/i.test(type)
        || !Number.isSafeInteger(length) || length <= 0 || length > getOfflineCacheLimit(username)) {
        await response.body?.cancel()
        return
      }
      let storedResponse = response
      if (!playbackResponse) {
        // 无 SW 时先在锁外流式暂存完整响应，避免慢速下载长期占用清理锁。
        staging = await caches.open('holly-offline-staging-v1')
        await cleanupOldStaging(staging)
        stagingKey = new URL(`/__offline_stage/${Date.now()}-${crypto.randomUUID()}`, window.location.origin).href
        await staging.put(stagingKey, new Response(verifiedAudioBody(response, length, controller.signal, epoch), { headers: response.headers }))
        const staged = await staging.match(stagingKey)
        if (!staged) return
        storedResponse = staged
      }
      if (epoch !== generation || controller.signal.aborted) return
      // 消费独立的已下载响应进行时长校验，再重新打开磁盘流供提交使用。
      // 不 clone/tee 整首数据，不把播放器中已被试听覆盖的显示时长当作期望。
      const duration = await readAudioDuration(storedResponse, controller.signal)
      if (!isAudioDurationValid(duration, storedTrack.duration)) return
      const checkedResponse = readPlaybackResponse
        ? await readPlaybackResponse()
        : staging && stagingKey ? await staging.match(stagingKey) : null
      if (!checkedResponse || epoch !== generation || controller.signal.aborted) return
      storedResponse = checkedResponse
      await withCacheLock(async () => {
        if (epoch !== generation) return
        // 下载期间设置可能已在其他标签页变更，提交前重新读取；超大单曲不清理已有缓存。
        const limit = getOfflineCacheLimit(username)
        if (length > limit) return
        const entries = (await listOfflineTracks(username)).filter(entry => entry.key !== key)
        const cleanup = planOfflineCleanup(entries, limit, length)
        if (epoch !== generation || controller.signal.aborted) return
        const headers = new Headers({ 'content-type': type, 'content-length': String(length), 'x-holly-verified-size': String(length),
          'x-holly-track': encodeURIComponent(JSON.stringify(storedTrack)), 'x-holly-quality': quality,
          'x-holly-used': String(Date.now()) })
        if (duration > 0) headers.set('x-holly-duration', String(duration))
        for (const name of ['etag', 'last-modified']) {
          const value = response.headers.get(name)
          if (value) headers.set(name, value)
        }
        let written = false
        let committed = false
        try {
          // 先写入，配额/存储失败时保留全部旧歌曲，不通过预先删除来重试。
          await cache.put(key, new Response(verifiedAudioBody(storedResponse, length, controller.signal, epoch), { headers }))
          written = true
          if (epoch !== generation || controller.signal.aborted) {
            await cache.delete(key)
            return
          }
          committed = true
          // 从此处开始提交淘汰：即使任务被取消，也保留新歌曲并完成清理。
          // 清空缓存等后续操作会等待同一把锁，不能在删掉旧歌曲后再回滚新歌曲。
          for (const entry of cleanup.entries) await cache.delete(entry.key)
        } finally {
          if (committed) markPlaybackCached(username, buildAudioUrl(track.uid, quality))
          // 清理失败或取消后也要刷新，避免列表展示已被删除的条目。
          if (written) changed()
        }
      })
    } catch (error) {
      if (!controller.signal.aborted) logOfflineFailure('[offline] 歌曲缓存失败，不影响在线播放', error)
    } finally {
      controller.abort()
      if (staging && stagingKey) await staging.delete(stagingKey)
        .catch(error => logOfflineFailure('[offline] 清理临时音频失败', error))
      clearTimeout(timeout)
      controllers.delete(controller)
      if (queued.get(job) === epoch) queued.delete(job)
    }
  }
  pending = pending.then(task, task)
  return pending
}

/** 本地完整 Blob 支持浏览器原生 seek；调用方负责 revokeObjectURL。 */
export async function getOfflineAudio(username: string, uid: string, quality: QualityType, allowed: QualityType[]): Promise<{ url: string; quality: QualityType } | null> {
  const entries = (await listOfflineTracks(username)).filter(entry => entry.track.uid === uid && allowed.includes(entry.quality))
  if (!entries.length) return null
  entries.sort((a, b) => Number(b.quality === quality) - Number(a.quality === quality))
  const cache = await caches.open(cacheName(username))
  for (const entry of entries) {
    const result = await withCacheLock(async () => {
      const response = await checkedCachedAudio(cache, entry.key, entry.track.duration)
      if (!response) return null
      const blob = await response.blob()
      if (blob.size !== entry.size) { await cache.delete(entry.key); changed(); return null }
      return { url: URL.createObjectURL(blob), quality: entry.quality }
    })
    if (result) return result
  }
  return null
}

export async function deleteOfflineTrack(username: string, key: string): Promise<void> {
  cancelOfflineDownloads()
  if (!isOfflineStorageAvailable()) return
  await withCacheLock(async () => { await (await caches.open(cacheName(username))).delete(key) })
  changed()
}
export async function clearOfflineTracks(username: string): Promise<void> {
  cancelOfflineDownloads()
  if (!isOfflineStorageAvailable()) return
  await withCacheLock(async () => { await caches.delete(cacheName(username)) })
  changed()
}
