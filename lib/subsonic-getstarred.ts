import { NextRequest } from 'next/server'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import { type AuthResult } from '@/lib/auth'
import favorites from '@/lib/favorites'
import dbAPI from '@/lib/db'

/* eslint-disable @typescript-eslint/no-explicit-any */

function escapeXml(unsafe: string) {
  return unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

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
      console.warn('[formatDate] Unexpected date type:', typeof date, date)
      return new Date().toISOString().substring(0, 19)
    }
    
    // 检查是否是有效的日期
    if (isNaN(d.getTime())) {
      console.warn('[formatDate] Invalid date:', date)
      return new Date().toISOString().substring(0, 19)
    }
    
    return d.toISOString().substring(0, 19)
  } catch (err) {
    console.warn('[formatDate] Error formatting date:', date, err)
    return new Date().toISOString().substring(0, 19)
  }
}

export async function handleGetStarred(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    if (!authRes.user) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 40, message: 'Authentication required' } })
      return createSubsonicResponse(xml)
    }

    const userId = authRes.user.id
    const url = new URL(request.url)
    console.log('[getStarred] Request URL:', url.toString())
    console.log('[getStarred] userId:', userId, 'user:', authRes.user.username)

    // 获取用户的所有收藏
    const favorites_list = await favorites.listFavorites(userId, { limit: 500 })
    console.log('[getStarred] Found', favorites_list.length, 'favorites for user', authRes.user.username)

    // 按类型分组
    const artists: any[] = []
    const albums: any[] = []
    const songs: any[] = []

    for (const fav of favorites_list) {
      const starredAttr = formatDate(fav.createdAt)

      if (fav.itemType === 'artist') {
        artists.push({
          id: escapeXml(fav.itemId),
          name: escapeXml(fav.itemId), // 由于只存了 ID，name 用 ID 代替（理想情况下需要查询艺术家名称）
          starred: starredAttr,
        })
      } else if (fav.itemType === 'album') {
        albums.push({
          id: escapeXml(fav.itemId),
          parent: escapeXml(fav.source || ''), // 使用 source 作为 parent
          title: escapeXml(fav.itemId),
          album: escapeXml(fav.itemId),
          artist: escapeXml(fav.source || 'Unknown'),
          isDir: 'true',
          coverArt: escapeXml(fav.itemId),
          created: formatDate(fav.createdAt),
          starred: starredAttr,
        })
      } else if (fav.itemType === 'song') {
        // 对于歌曲，尝试从 MusicInfo 表查询完整信息
        try {
          console.log('[getStarred] Fetching MusicInfo for song:', fav.itemId)
          const musicInfo = await dbAPI.getMusicInfoBySongmid(fav.itemId)
          if (musicInfo) {
            console.log('[getStarred] Got MusicInfo for', fav.itemId, 'interval:', musicInfo.interval, 'type:', typeof musicInfo.interval)
            // 安全地解析 interval（格式：mm:ss 或 h:mm:ss）
            let duration = 0
            if (musicInfo.interval && typeof musicInfo.interval === 'string') {
              try {
                const parts = musicInfo.interval.split(':').map((s: string) => parseInt(s, 10))
                duration = parts.reduce((acc: number, val: number) => acc * 60 + val, 0)
              } catch (err) {
                console.warn('[getStarred] Failed to parse interval:', musicInfo.interval, err)
                duration = 0
              }
            }

            const bitRate = musicInfo._types?.['320k'] ? 320 : (musicInfo._types?.['128k'] ? 128 : 0)
            let size = '0'
            if (musicInfo._types && typeof musicInfo._types === 'object') {
              const firstType = Object.values(musicInfo._types)[0]
              if (firstType && typeof firstType === 'object' && 'size' in firstType) {
                size = String((firstType as any).size || 0)
              }
            }
            
            songs.push({
              id: escapeXml(musicInfo.songmid || fav.itemId),
              parent: escapeXml(musicInfo.albumId || ''),
              title: escapeXml(musicInfo.name || ''),
              album: escapeXml(musicInfo.albumName || ''),
              artist: escapeXml(musicInfo.singer || ''),
              isDir: 'false',
              coverArt: escapeXml(musicInfo.albumId || ''),
              created: formatDate(fav.createdAt),
              starred: formatDate(fav.createdAt),
              duration: String(duration),
              bitRate: String(bitRate),
              track: '0',
              year: '0',
              genre: 'Unknown',
              size,
              suffix: 'mp3',
              contentType: 'audio/mpeg',
              isVideo: 'false',
              path: escapeXml(musicInfo.singer ? `${musicInfo.singer}/${musicInfo.albumName || ''}/${musicInfo.name}` : musicInfo.name),
              albumId: escapeXml(musicInfo.albumId || ''),
              artistId: '',
              type: 'music',
              source: musicInfo.source,
            })
          } else {
            // 如果查不到，使用默认信息
            console.log('[getStarred] MusicInfo not found for', fav.itemId, 'using defaults')
            songs.push({
              id: escapeXml(fav.itemId),
              parent: '',
              title: escapeXml(fav.itemId),
              album: escapeXml(fav.source || 'Unknown'),
              artist: escapeXml(fav.source || 'Unknown'),
              isDir: 'false',
              coverArt: '',
              created: formatDate(fav.createdAt),
              starred: formatDate(fav.createdAt),
              duration: '0',
              bitRate: '320',
              track: '0',
              year: '0',
              genre: 'Unknown',
              size: '0',
              suffix: 'mp3',
              contentType: 'audio/mpeg',
              isVideo: 'false',
              path: escapeXml(fav.itemId),
              albumId: '',
              artistId: '',
              type: 'music',
            })
          }
        } catch (err) {
          console.error('[getStarred] Error fetching MusicInfo for', fav.itemId, ':', err)
          // 查询失败时使用默认信息
          songs.push({
            id: escapeXml(fav.itemId),
            parent: '',
            title: escapeXml(fav.itemId),
            album: escapeXml(fav.source || 'Unknown'),
            artist: escapeXml(fav.source || 'Unknown'),
            isDir: 'false',
            coverArt: '',
            created: formatDate(fav.createdAt),
            starred: formatDate(fav.createdAt),
            duration: '0',
            bitRate: '320',
            track: '0',
            year: '0',
            genre: 'Unknown',
            size: '0',
            suffix: 'mp3',
            contentType: 'audio/mpeg',
            isVideo: 'false',
            path: escapeXml(fav.itemId),
            albumId: '',
            artistId: '',
            type: 'music',
          })
        }
      }
    }

    // 构建 XML
    const artistNodes = artists
      .map(
        a => `\t<artist name="${a.name}" id="${a.id}" starred="${a.starred}"/>`
      )
      .join('\n')

    const albumNodes = albums
      .map(
        a =>
          `\t<album id="${a.id}" parent="${a.parent}" title="${a.title}" album="${a.album}" artist="${a.artist}" isDir="${a.isDir}" coverArt="${a.coverArt}" created="${a.created}" starred="${a.starred}"/>`
      )
      .join('\n')

    const songNodes = songs
      .map(
        s =>
          `\t<song id="${s.id}" parent="${s.parent}" title="${s.title}" album="${s.album}" artist="${s.artist}" isDir="${s.isDir}" coverArt="${s.coverArt}" created="${s.created}" starred="${s.starred}" duration="${s.duration}" bitRate="${s.bitRate}" track="${s.track}" year="${s.year}" genre="${s.genre}" size="${s.size}" suffix="${s.suffix}" contentType="${s.contentType}" isVideo="${s.isVideo}" path="${s.path}" albumId="${s.albumId}" artistId="${s.artistId}" type="${s.type}"/>`
      )
      .join('\n')

    // 合并所有节点
    const allNodes = [artistNodes, albumNodes, songNodes].filter(Boolean).join('\n')
    
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1">
${allNodes}
</subsonic-response>`
    
    console.log('[getStarred] Returning', artists.length, 'artists,', albums.length, 'albums,', songs.length, 'songs')
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(xml, 'utf8'))
      }
    })
  } catch (err) {
    console.error('[getStarred] Error:', err)
    const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: err instanceof Error ? err.message : 'Internal error' } })
    return createSubsonicResponse(xml)
  }
}
