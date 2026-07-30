import { NextRequest } from 'next/server'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import type { MusicInfo } from '@/lib/types/music'
import { upsertMusicInfo, getStorageSongmidForMusicInfo } from '@/lib/db'
import { searchCache } from '@/lib/cache-manager'
import { logger } from '@/lib/logger'
import { buildSubsonicSearchCacheKey } from '@/lib/cache-key'
import { getSearchCacheTTL } from '@/lib/cache-config'
// song id 统一使用 `source-songmid` 复合格式，保证跨源唯一

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseOffset(v: string | undefined) {
  if (!v) return 0
  const n = parseInt(v)
  return Number.isNaN(n) ? 0 : n
}

function parseDuration(interval: string | undefined) {
  if (!interval) return 0
  const parts = interval.split(':').map(p => parseInt(p))
  if (parts.length === 2) return parts[0] * 60 + (parts[1] || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
  return 0
}

export async function handleSearch(request: NextRequest) {
  const url = new URL(request.url)
  const q = url.searchParams.get('query') || url.searchParams.get('q') || ''
  const songCount = 50 //parseCount(url.searchParams.get('songCount') ?? undefined, 20)
  const songOffset = parseOffset(url.searchParams.get('songOffset') ?? undefined)

  // aggregate sources used for search (moved outside try so cache key can be computed)
  const sources = ['tx','wy', 'kw', 'kg', 'mg']
  const cacheKey = buildSubsonicSearchCacheKey(q, sources, songCount, songOffset)
  const cachedXml = searchCache.get(cacheKey) as string | null
  if (cachedXml) {
    logger.debug('[subsonic-search] cache hit', cacheKey)
    return createSubsonicResponse(cachedXml)
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

    // build XML children following Subsonic searchResult3 song attributes
    const songNodes = sliced.map((s, idx) => {
      // 对外 song id = `source-{存储songmid}`，与 DB 的 songmid 列一致，
      // 使 stream 等接口能通过 (source, 存储songmid) 精确命中 DB 记录。
      // 注意：存储键可能与 mi.songmid 不同（kg 用 FileHash 而非 Audioid）。
      const songId = `${s.source}-${getStorageSongmidForMusicInfo(s) || s.songId || idx}`

      // parent/coverArt/albumId 统一用 source-{songmid}（= songId），
      // 让 Musiver 从任意一首歌的 albumId 调 getAlbum 都能定位到整张专辑
      const parent = songId
      const title = escapeXml(String(s.name || s.title || ''))
      const album = escapeXml(String(s.albumName || s.album || ''))
      const artist = escapeXml(String(s.singer || s.artist || ''))
      const duration = parseDuration(s.interval)
      const bitRate = s._types && s._types['320k'] ? 320 : (s._types && s._types['128k'] ? 128 : 0)
      const rawSize = s._types && Object.values(s._types)[0] && (Object.values(s._types)[0] as any).size ? (Object.values(s._types)[0] as any).size : (s.size || s.fileSize || 0)
      const sizeNum = Number.parseInt(String(rawSize || 0), 10) || 0
      const suffix = 'mp3'
      const contentType = 'audio/mpeg'
      const coverArt = parent || ''
      const albumId = parent || ''
      const artistId = s.artistId || ''
      const pathAttr = escapeXml(String(s.path || s.filePath || ''))

      // compute track number within album (1-based)
      let trackAttr = ''
      const albumKey = (s.albumId || s.albummid || `${s.source}-album-${(s.albumName || s.album || '').replace(/\s+/g, '-')}`) as string
      const albumEntry = albumMap.get(albumKey)
      if (albumEntry && Array.isArray(albumEntry.songs)) {
        const pos = albumEntry.songs.indexOf(songId)
        if (pos >= 0) trackAttr = String(pos + 1)
      }

      const trackPart = trackAttr ? ` track="${trackAttr}"` : ''

      return `<song id="${songId}" parent="${parent}" title="${title}" album="${album}" artist="${artist}" isDir="false" coverArt="${coverArt}" duration="${duration}" bitRate="${bitRate}" size="${sizeNum}" suffix="${suffix}" contentType="${contentType}" isVideo="false" path="${pathAttr}" albumId="${albumId}" artistId="${artistId}" type="music"${trackPart}/>`
    }).join('')

    // emit artists first, then albums, then songs
    const children = `<searchResult3>${songNodes}</searchResult3>`
    // const children = `<searchResult3>${artistNodes}${albumNodes}${songNodes}</searchResult3>`
    const xml = formatSubsonicXML({ status: 'ok', children })
    
    // cache the generated XML for subsequent identical searches
    try {
      const ttl = getSearchCacheTTL()
      searchCache.set(cacheKey, xml, ttl)
    } catch (err) {
      // ignore cache set errors
      logger.warn('[subsonic-search] failed to set cache', err)
    }
    
    console.log(xml)
    return createSubsonicResponse(xml)
  } catch (err) {
    const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: err instanceof Error ? err.message : 'search error' } })
    return createSubsonicResponse(xml)
  }
}

function escapeXml(unsafe: string) {
  return unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
