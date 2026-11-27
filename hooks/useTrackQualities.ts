import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '@/hooks/useAuth'
import { getTrackQualities } from '@/lib/api/music'
import { mergeQualityInfos, TRACK_QUALITY_BATCH_SIZE } from '@/lib/platform-qualities'
import type { QualityInfo } from '@/lib/types/music'

type Listener = (qualities: QualityInfo[]) => void
const CACHE_TTL_MS = 60_000
const CACHE_LIMIT = 300
const cache = new Map<string, { qualities: QualityInfo[]; expires: number }>()
const queued = new Map<string, Set<Listener>>()
const inFlight = new Map<string, Set<Listener>>()
let flushing = false

function scheduleBatch() {
  if (flushing || queued.size === 0) return
  flushing = true
  queueMicrotask(async () => {
    const batch = [...queued.entries()].slice(0, TRACK_QUALITY_BATCH_SIZE)
    for (const [uid, listeners] of batch) {
      queued.delete(uid)
      inFlight.set(uid, listeners)
    }
    try {
      if (batch.length === 0) return
      const results = await getTrackQualities(batch.map(([uid]) => uid))
      for (const [uid, listeners] of batch) {
        const qualities = results[uid] ?? []
        if (cache.size >= CACHE_LIMIT) {
          const oldest = cache.keys().next().value
          if (oldest) cache.delete(oldest)
        }
        cache.set(uid, { qualities, expires: Date.now() + CACHE_TTL_MS })
        listeners.forEach(listener => listener(qualities))
      }
    } catch {
      // 保留页面原有音质。列表重新打开时可重试。
    } finally {
      for (const [uid] of batch) inFlight.delete(uid)
      flushing = false
      scheduleBatch()
    }
  })
}

function subscribe(uid: string, listener: Listener): () => void {
  const cached = cache.get(uid)
  if (cached && cached.expires > Date.now()) {
    listener(cached.qualities)
    return () => {}
  }
  cache.delete(uid)
  const listeners = inFlight.get(uid) ?? queued.get(uid) ?? new Set<Listener>()
  listeners.add(listener)
  if (!inFlight.has(uid)) {
    queued.set(uid, listeners)
    scheduleBatch()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) queued.delete(uid)
  }
}

/** 已挂载的歌曲行合并查询，下载与播放器复用同一批请求。 */
export function useTrackQualities(uid: string | undefined, types?: QualityInfo[]): QualityInfo[] | undefined {
  const authenticated = useAuthStore(state => state.authenticated && !state.offlineUsername)
  const [loaded, setLoaded] = useState<{ uid: string; qualities: QualityInfo[] }>()
  useEffect(() => {
    if (!uid || !authenticated || !navigator.onLine) return
    return subscribe(uid, qualities => setLoaded({ uid, qualities }))
  }, [uid, authenticated])

  return useMemo(() => loaded && loaded.uid === uid ? mergeQualityInfos(types, loaded.qualities) : types,
    [loaded, uid, types])
}
