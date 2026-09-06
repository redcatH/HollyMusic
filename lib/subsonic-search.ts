import { NextRequest } from 'next/server'
import { respond, subsonicError, type SubsonicPayload, type SubsonicSongNode } from '@/lib/subsonic'
import { resolveSubsonicMediaMeta } from '@/lib/subsonic-media'
import type { MusicInfo } from '@/lib/types/music'
import { upsertMusicInfo, getStorageSongmidForMusicInfo, getRandomMusicInfoList } from '@/lib/db'
import { searchCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'
import { buildSubsonicSearchCacheKey } from '@/lib/cache-key'
import { getSearchCacheTTL } from '@/lib/cache-config'
import { getSearchSources } from '@/lib/search-config'
import type { AuthResult } from '@/lib/auth'
import { listHistory } from '@/lib/services/history-service'
// song id 统一使用 `source-songmid` 复合格式，保证跨源唯一

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Subsonic 搜索前缀所支持的内置渠道。 */
export const SUBSONIC_SEARCH_SOURCES = ['tx', 'wy', 'kw', 'kg', 'mg'] as const

type SubsonicSearchSource = typeof SUBSONIC_SEARCH_SOURCES[number]

/**
 * 解析 Subsonic 搜索关键词中的渠道前缀。
 *
 * 例如 `tx:风说` 会转换为 QQ 音乐渠道和实际关键词 `风说`。未识别的
 * 前缀保持原样，继续执行原有的多渠道聚合搜索，避免改变普通歌曲名的行为。
 */
export function parseSubsonicSearchQuery(rawQuery: string): {
  query: string
  source?: SubsonicSearchSource
} {
  const query = rawQuery.trim()
  const match = query.match(/^(tx|wy|kw|kg|mg)\s*:\s*(.*)$/i)
  if (!match) return { query }

  return {
    source: match[1].toLowerCase() as SubsonicSearchSource,
    query: match[2].trim(),
  }
}

function parseOffset(v: string | undefined) {
  if (!v) return 0
  const n = parseInt(v)
  return Number.isNaN(n) ? 0 : n
}

/** 解析协议的 songCount 参数：1–500，缺失/非法回默认 50（仅作为返回数量上限，不影响对上游的请求量） */
export function parseSongCount(raw: string | null): number {
  const n = parseInt(raw ?? '', 10)
  if (Number.isNaN(n)) return 50
  return Math.max(1, Math.min(n, 500))
}

function parseDuration(interval: string | undefined) {
  if (!interval) return 0
  const parts = interval.split(':').map(p => parseInt(p))
  if (parts.length === 2) return parts[0] * 60 + (parts[1] || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
  return 0
}

/** song 节点构造（空 query 随机分支用；与 getRandomSongs 端点同规则） */
function buildSongNode(s: MusicInfo, idx: number, created?: string): SubsonicSongNode {
  const songId = `${s.source}-${getStorageSongmidForMusicInfo(s) || s.songId || idx}`
  const meta = resolveSubsonicMediaMeta(s)
  return {
    id: songId,
    parent: songId,
    title: s.name || '',
    album: s.albumName || '',
    artist: s.singer || '',
    isDir: false,
    coverArt: songId,
    duration: parseDuration(s.interval),
    bitRate: meta.bitRate,
    size: meta.size,
    suffix: meta.suffix,
    contentType: meta.contentType,
    isVideo: false,
    path: '',
    albumId: songId,
    artistId: '',
    type: 'music',
    ...(created ? { created } : {}),
  }
}

async function handleRecentSearch(
  request: NextRequest,
  username: string | undefined,
  count: number,
  offset: number
): Promise<Response> {
  const history = username ? await listHistory(username, { limit: count, offset }) : { list: [] }
  const songs = history.list.flatMap((entry, index) => entry.musicInfo
    ? [buildSongNode(entry.musicInfo, index, entry.playedAt)]
    : [])
  return respond(request, { searchResult3: { song: songs } })
}

export async function handleSearch(request: NextRequest, authRes?: AuthResult) {
  const url = new URL(request.url)
  const rawQuery = (url.searchParams.get('query') || url.searchParams.get('q') || '').trim()
  const { query: q, source: selectedSource } = parseSubsonicSearchQuery(rawQuery)
  const songCount = parseSongCount(url.searchParams.get('songCount'))
  const songOffset = parseOffset(url.searchParams.get('songOffset') ?? undefined)

  // 部分客户端以空 query + order=playDate 读取最近播放，不能误返回随机推荐。
  if (!q && url.searchParams.get('order')?.toLowerCase() === 'playdate') {
    try {
      return await handleRecentSearch(request, authRes?.user?.username, songCount, songOffset)
    } catch (err) {
      logger.error('[subsonic-search] failed to list recent plays', err)
      return subsonicError(request, 0, 'Failed to list recent plays')
    }
  }

  // 空 query：客户端（如箭头音乐）打开 App 时的「随便听听」预加载（artistCount/albumCount 也为 0）。
  // 与 PC 首页「发现音乐」同源：从推荐白名单随机抽取（getRandomMusicInfoList），
  // 不触发任何聚合搜索（对音源零请求），结果每次随机故不走缓存。
  if (!q) {
    try {
      const allowedSources = selectedSource ? [selectedSource] : getSearchSources()
      const songs = await getRandomMusicInfoList(songCount, allowedSources)
      const songNodes = songs.map((s, idx) => buildSongNode(s, idx))
      logger.debug('[subsonic-search] empty query -> random from recommended pool:', songNodes.length)
      return respond(request, { searchResult3: { song: songNodes } })
    } catch (err) {
      logger.error('[subsonic-search] empty query random error:', err)
      return subsonicError(request, 0, err instanceof Error ? err.message : 'search error')
    }
  }

  // aggregate sources used for search (moved outside try so cache key can be computed)
  const sources = selectedSource ? [selectedSource] : getSearchSources()
  const cacheKey = buildSubsonicSearchCacheKey(q, sources, songCount, songOffset)
  // 缓存 payload 对象而非序列化结果，命中后仍可按 f= 参数渲染 XML/JSON
  const cachedPayload = searchCache.get(cacheKey) as SubsonicPayload | null
  if (cachedPayload) {
    logger.debug('[subsonic-search] cache hit', cacheKey)
    return respond(request, cachedPayload)
  }

  try {
    // aggregate results from multiple sources until we have enough songs
    const songs: Array<MusicInfo & Record<string, any>> = []

    const musicSearchModule = await import('@/lib/music-core/music-search')
    // support both default export and module.exports
    const musicSearch: any = (musicSearchModule && (musicSearchModule as any).default) || musicSearchModule

    for (const src of sources) {
      if (songs.length >= songCount + songOffset) break
      try {
        const res  = await musicSearch.search(src, q, 1, 10)
        if (res && Array.isArray(res.list)) {
          for (const item of res.list) {
            const raw = item as any
            // musicInfo.songmid 保持各音源原始值（kg 为 Audioid，其他为原 songmid/songId），
            // 这是"原始数据"，会原样存入 DB 的 data 列，播放时拉起的就是它，保证正常播放。
            // 对外 id 的唯一性由 upsertMusicInfo 的 songmid 列存储策略保证（见 db.ts）。
            const musicInfo: MusicInfo = {
              name: raw.name || raw.title || '',
              singer: raw.singer || raw.artist || '',
              source: src as any,
              songmid: String(raw.songmid ?? raw.songId ?? ''),
              interval: raw.interval || '0:00',
              types: raw.types || [],
              _types: raw._types || {},
              typeUrl: raw.typeUrl || {},
            }
            if (raw.albumId) musicInfo.albumId = raw.albumId
            if (raw.albummid) musicInfo.albumId = raw.albummid
            if (raw.albumMid) musicInfo.albumId = raw.albumMid
            if (raw.albumName) musicInfo.albumName = raw.albumName
            if (raw.album) musicInfo.albumName = raw.album
            if (raw.img !== undefined) musicInfo.img = raw.img
            if (raw.hash) musicInfo.hash = raw.hash
            if (raw.copyrightId) musicInfo.copyrightId = raw.copyrightId
            if (raw.songId !== undefined) musicInfo.songId = raw.songId
            if (raw.strMediaMid) musicInfo.strMediaMid = raw.strMediaMid
            if (raw.albumMid) musicInfo.albumMid = raw.albumMid
            if (raw.lrc !== undefined) musicInfo.lrc = raw.lrc
            if (raw.lrcUrl) musicInfo.lrcUrl = raw.lrcUrl
            if (raw.mrcUrl) musicInfo.mrcUrl = raw.mrcUrl
            if (raw.trcUrl) musicInfo.trcUrl = raw.trcUrl

            // keep some legacy aliases used elsewhere in this file
            ;(musicInfo as any).artist = musicInfo.singer
            ;(musicInfo as any).album = musicInfo.albumName
            ;(musicInfo as any).albummid = raw.albummid || raw.albumMid || musicInfo.albumId
            ;(musicInfo as any).title = musicInfo.name
            ;(musicInfo as any).year = raw.year || raw.publishTime

            // persist musicInfo (insert/update if changed)
            try {
              await upsertMusicInfo(musicInfo)
            } catch (err) {
              // ignore DB errors — do not break search
              console.warn('upsertMusicInfo error', err)
            }

            songs.push(musicInfo)
            if (songs.length >= songCount + songOffset) break
          }
        }
      } catch {
        // ignore source errors
      }
    }

    // slice according to offset/count
    const sliced = songs.slice(songOffset, songOffset + songCount)

    // Build album grouping from the sliced songs so we can return <album> nodes
    const albumMap = new Map<string, any>()
    for (const s of sliced) {
      const artistKey = (s.artistId || s.singer || s.artist || `${s.source}-artist-${(s.singer || s.artist || '').replace(/\s+/g, '-')}`) as string
      const albumKey = (s.albumId || s.albummid || `${s.source}-album-${(s.albumName || s.album || '').replace(/\s+/g, '-')}`) as string
      const albumEntry = albumMap.get(albumKey) || {
        id: albumKey,
        name: s.albumName || s.album || '',
        artist: s.singer || s.artist || '',
        artistId: artistKey,
        coverArt: s.albumId || s.albummid || '',
        year: s.year || s.publishTime || '',
        songCount: 0,
        songs: [] as string[],
      }
      const songKey = `${s.source}-${getStorageSongmidForMusicInfo(s) || s.songId || (albumEntry.songs.length + 1)}`
      albumEntry.songCount = (albumEntry.songCount || 0) + 1
      albumEntry.songs.push(songKey)
      albumMap.set(albumKey, albumEntry)
    }

    // album nodes are generated on-demand when needed; albumMap is preserved for track order

    // Build artist grouping from the sliced songs
    const artistMap = new Map<string, { id: string, name: string, albumSet: Set<string>, songCount: number }>()
    for (const s of sliced) {
      const artistKey = (s.artistId || s.singer || s.artist || `${s.source}-artist-${(s.singer || s.artist || '').replace(/\s+/g, '-')}`) as string
      const albumKey = (s.albumId || s.albummid || `${s.source}-album-${(s.albumName || s.album || '').replace(/\s+/g, '-')}`) as string
      const entry = artistMap.get(artistKey) || { id: artistKey, name: s.singer || s.artist || '', albumSet: new Set<string>(), songCount: 0 }
      entry.albumSet.add(albumKey)
      entry.songCount = (entry.songCount || 0) + 1
      artistMap.set(artistKey, entry)
    }

    // artist nodes not emitted currently; artistMap preserved for potential future use

    // build song nodes following Subsonic searchResult3 attributes（XML 转义由渲染层统一处理）
    const songNodes: SubsonicSongNode[] = sliced.map((s, idx) => {
      // 对外 song id = `source-{存储songmid}`，与 DB 的 songmid 列一致，
      // 使 stream 等接口能通过 (source, 存储songmid) 精确命中 DB 记录。
      // 注意：存储键可能与 mi.songmid 不同（kg 用 FileHash 而非 Audioid）。
      const songId = `${s.source}-${getStorageSongmidForMusicInfo(s) || s.songId || idx}`

      // parent/coverArt/albumId 统一用 source-{songmid}（= songId），
      // 让 Musiver 从任意一首歌的 albumId 调 getAlbum 都能定位到整张专辑
      const duration = parseDuration(s.interval)
      const meta = resolveSubsonicMediaMeta(s)

      // compute track number within album (1-based)
      let track: number | undefined
      const albumKey = (s.albumId || s.albummid || `${s.source}-album-${(s.albumName || s.album || '').replace(/\s+/g, '-')}`) as string
      const albumEntry = albumMap.get(albumKey)
      if (albumEntry && Array.isArray(albumEntry.songs)) {
        const pos = albumEntry.songs.indexOf(songId)
        if (pos >= 0) track = pos + 1
      }

      return {
        id: songId,
        parent: songId,
        title: String(s.name || s.title || ''),
        album: String(s.albumName || s.album || ''),
        artist: String(s.singer || s.artist || ''),
        isDir: false,
        coverArt: songId,
        duration,
        bitRate: meta.bitRate,
        size: meta.size,
        suffix: meta.suffix,
        contentType: meta.contentType,
        isVideo: false,
        path: String(s.path || s.filePath || ''),
        albumId: songId,
        artistId: s.artistId || '',
        type: 'music',
        track,
      }
    })

    const payload: SubsonicPayload = { searchResult3: { song: songNodes } }

    // cache the generated payload for subsequent identical searches
    try {
      const ttl = getSearchCacheTTL()
      searchCache.set(cacheKey, payload, ttl)
    } catch (err) {
      // ignore cache set errors
      logger.warn('[subsonic-search] failed to set cache', err)
    }

    logger.debug('[subsonic-search] returning', songNodes.length, 'songs for query:', q)
    return respond(request, payload)
  } catch (err) {
    return subsonicError(request, 0, err instanceof Error ? err.message : 'search error')
  }
}
