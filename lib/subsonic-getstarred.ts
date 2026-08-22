import { NextRequest } from 'next/server'
import { respond, subsonicError, type SubsonicPayload } from '@/lib/subsonic'
import { resolveSubsonicMediaMeta } from '@/lib/subsonic-media'
import { type AuthResult } from '@/lib/auth'
import favorites from '@/lib/favorites'
import dbAPI, { getStorageSongmidForMusicInfo } from '@/lib/db'
import { logger } from '@/lib/logger'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 格式化 ISO 日期为 Subsonic 格式
 * 例如：2024-12-01T10:30:45.123Z -> 2024-12-01T10:30:45
 */
function formatDate(date: any): string {
  try {
    // 安全地处理各种输入
    if (!date) {
      return new Date().toISOString().substring(0, 19)
    }

    let d: Date
    if (date instanceof Date) {
      d = date
    } else if (typeof date === 'string') {
      d = new Date(date)
    } else if (typeof date === 'number') {
      d = new Date(date)
    } else {
      logger.warn('[formatDate] Unexpected date type:', typeof date, date)
      return new Date().toISOString().substring(0, 19)
    }

    // 检查是否是有效的日期
    if (isNaN(d.getTime())) {
      logger.warn('[formatDate] Invalid date:', date)
      return new Date().toISOString().substring(0, 19)
    }

    return d.toISOString().substring(0, 19)
  } catch (err) {
    logger.warn('[formatDate] Error formatting date:', date, err)
    return new Date().toISOString().substring(0, 19)
  }
}

export async function handleGetStarred(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    if (!authRes.user) {
      return subsonicError(request, 40, 'Authentication required')
    }

    const userId = authRes.user.id
    const url = new URL(request.url)
    logger.debug('[getStarred] Request URL:', url.toString(), 'userId:', userId, 'user:', authRes.user.username)

    // 获取用户的所有收藏
    const favorites_list = await favorites.listFavorites(userId, { limit: 500 })
    logger.debug('[getStarred] Found', favorites_list.length, 'favorites for user', authRes.user.username)

    // 按类型分组（XML 转义由响应渲染层统一处理，这里只组装原始值）
    const artists: SubsonicPayload[] = []
    const albums: SubsonicPayload[] = []
    const songs: SubsonicPayload[] = []

    for (const fav of favorites_list) {
      const starredAttr = formatDate(fav.createdAt)

      if (fav.itemType === 'artist') {
        artists.push({
          name: fav.itemId, // 由于只存了 ID，name 用 ID 代替（理想情况下需要查询艺术家名称）
          id: fav.itemId,
          starred: starredAttr,
        })
      } else if (fav.itemType === 'album') {
        albums.push({
          id: fav.itemId,
          parent: fav.source || '', // 使用 source 作为 parent
          title: fav.itemId,
          album: fav.itemId,
          artist: fav.source || 'Unknown',
          isDir: true,
          coverArt: fav.itemId,
          created: formatDate(fav.createdAt),
          starred: starredAttr,
        })
      } else if (fav.itemType === 'song') {
        // 对于歌曲，尝试从 MusicInfo 表查询完整信息
        try {
          logger.debug('[getStarred] Fetching MusicInfo for song:', fav.itemId)
          const musicInfo = await dbAPI.resolveMusicInfoById(fav.itemId)
          if (musicInfo) {
            logger.debug('[getStarred] Got MusicInfo for', fav.itemId, 'interval:', musicInfo.interval, 'type:', typeof musicInfo.interval)
            // 安全地解析 interval（格式：mm:ss 或 h:mm:ss）
            let duration = 0
            if (musicInfo.interval && typeof musicInfo.interval === 'string') {
              try {
                const parts = musicInfo.interval.split(':').map((s: string) => parseInt(s, 10))
                duration = parts.reduce((acc: number, val: number) => acc * 60 + val, 0)
              } catch (err) {
                logger.warn('[getStarred] Failed to parse interval:', musicInfo.interval, err)
                duration = 0
              }
            }

            const meta = resolveSubsonicMediaMeta(musicInfo)

            // id/parent/coverArt/albumId 统一用 source-{songmid}（从 musicInfo 重算存储键）
            const songId = `${musicInfo.source}-${getStorageSongmidForMusicInfo(musicInfo)}`
            songs.push({
              id: songId,
              parent: songId,
              title: musicInfo.name || '',
              album: musicInfo.albumName || '',
              artist: musicInfo.singer || '',
              isDir: false,
              coverArt: songId,
              created: formatDate(fav.createdAt),
              starred: formatDate(fav.createdAt),
              duration,
              bitRate: meta.bitRate,
              track: 0,
              year: 0,
              genre: 'Unknown',
              size: meta.size,
              suffix: meta.suffix,
              contentType: meta.contentType,
              isVideo: false,
              path: musicInfo.singer ? `${musicInfo.singer}/${musicInfo.albumName || ''}/${musicInfo.name}` : musicInfo.name,
              albumId: songId,
              artistId: '',
              type: 'music',
              source: musicInfo.source,
            })
          } else {
            // 如果查不到，使用默认信息
            logger.debug('[getStarred] MusicInfo not found for', fav.itemId, 'using defaults')
            songs.push(buildDefaultStarredSong(fav.itemId, fav.source, formatDate(fav.createdAt)))
          }
        } catch (err) {
          logger.error('[getStarred] Error fetching MusicInfo for', fav.itemId, ':', err)
          // 查询失败时使用默认信息
          songs.push(buildDefaultStarredSong(fav.itemId, fav.source, formatDate(fav.createdAt)))
        }
      }
    }

    logger.debug('[getStarred] Returning', artists.length, 'artists,', albums.length, 'albums,', songs.length, 'songs')
    return respond(request, {
      starred: { artist: artists, album: albums, song: songs },
    })
  } catch (err) {
    logger.error('[getStarred] Error:', err)
    return subsonicError(request, 0, err instanceof Error ? err.message : 'Internal error')
  }
}

/** 查不到 MusicInfo 时的兜底 song 节点（无真实音质数据，相关字段省略不编造） */
function buildDefaultStarredSong(itemId: string, source: string | null | undefined, starred: string): SubsonicPayload {
  return {
    id: itemId,
    parent: '',
    title: itemId,
    album: source || 'Unknown',
    artist: source || 'Unknown',
    isDir: false,
    coverArt: '',
    created: starred,
    starred,
    duration: 0,
    track: 0,
    year: 0,
    genre: 'Unknown',
    isVideo: false,
    path: itemId,
    albumId: '',
    artistId: '',
    type: 'music',
  }
}
