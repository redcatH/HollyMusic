import { NextRequest } from 'next/server'
import { respond, subsonicError, type SubsonicSongNode } from './subsonic'
import { getRandomMusicInfoList, getStorageSongmidForMusicInfo } from './db'
import { getSearchSources } from './search-config'
import { logger } from './logger'
import type { MusicInfo } from './types/music'

/* eslint-disable @typescript-eslint/no-explicit-any */

// song id 统一使用 `source-{存储songmid}` 复合格式，与 search3/stream 一致，保证可播放

function parseDuration(interval: string | undefined): number {
  if (!interval) return 0
  const parts = interval.split(':').map(p => parseInt(p))
  if (parts.length === 2) return parts[0] * 60 + (parts[1] || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
  return 0
}

/**
 * Subsonic getRandomSongs：从 DB 已入库曲目中随机返回 size 首。
 * 返回的 song id 与 search3 一致（source-{存储songmid}），可直接被 stream 播放。
 */
export async function handleGetRandomSongs(request: NextRequest): Promise<Response> {
  const url = new URL(request.url)
  const parsed = parseInt(url.searchParams.get('size') ?? '10', 10)
  const size = Number.isNaN(parsed) ? 10 : Math.max(1, Math.min(parsed, 500))

  try {
    // 只抽取当前配置下可播放平台的歌（enabled 音源的 pt 并集），与搜索侧一致
    const allowedSources = getSearchSources()
    const songs: MusicInfo[] = await getRandomMusicInfoList(size, allowedSources)

    const songNodes: SubsonicSongNode[] = songs.map((s, idx) => {
      const a = s as any
      // 对外 song id = `source-{存储songmid}`，与 search3/stream 一致
      const songId = `${s.source}-${getStorageSongmidForMusicInfo(s) || s.songId || idx}`
      const duration = parseDuration(s.interval)
      const bitRate = s._types && s._types['320k'] ? 320 : (s._types && s._types['128k'] ? 128 : 0)
      const firstType = s._types ? (Object.values(s._types)[0] as any) : null
      const sizeBytes = firstType && firstType.size ? firstType.size : (a.size || a.fileSize || 0)
      const sizeNum = Number.parseInt(String(sizeBytes || 0), 10) || 0

      return {
        id: songId,
        parent: songId,
        title: String(s.name || a.title || ''),
        album: String(s.albumName || a.album || ''),
        artist: String(s.singer || a.artist || ''),
        isDir: false,
        coverArt: songId,
        duration,
        bitRate,
        size: sizeNum,
        suffix: 'mp3',
        contentType: 'audio/mpeg',
        isVideo: false,
        path: String(a.path || a.filePath || ''),
        albumId: songId,
        artistId: '',
        type: 'music',
      }
    })

    return respond(request, { randomSongs: { song: songNodes } })
  } catch (err) {
    logger.error('[getRandomSongs] error:', err)
    return subsonicError(request, 0, err instanceof Error ? err.message : 'getRandomSongs error')
  }
}
