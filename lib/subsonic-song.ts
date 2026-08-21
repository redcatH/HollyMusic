import { NextRequest } from 'next/server'
import { respond, subsonicError, type SubsonicSongNode } from './subsonic'
import { type AuthResult } from './auth'
import * as dbAPI from './db'
import { logger } from './logger'

/**
 * 将时间字符串转换为秒
 * 支持格式: "03:12" -> 192, "1:30:45" -> 5445, 或直接传入数字
 */
function parseDurationToSeconds(duration: string | number | undefined): number {
  if (!duration) return 180 // 默认 3 分钟

  // 如果已经是数字，直接返回
  if (typeof duration === 'number') return duration

  // 如果是字符串，尝试解析
  if (typeof duration === 'string') {
    const parts = duration.split(':').map(Number)

    if (parts.length === 2) {
      // MM:SS 格式
      return parts[0] * 60 + parts[1]
    } else if (parts.length === 3) {
      // HH:MM:SS 格式
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    } else if (parts.length === 1 && !isNaN(parts[0])) {
      // 单纯数字字符串
      return parts[0]
    }
  }

  return 180 // 默认值
}

export async function handleGetSongAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return subsonicError(request, 50, 'Required parameter missing: id')
    }

    // 从数据库查询 MusicInfo（统一走 resolveMusicInfoById，兼容 source-songmid 复合 id 与纯 songmid）
    const musicInfo = await dbAPI.resolveMusicInfoById(id)

    if (!musicInfo) {
      return subsonicError(request, 70, 'Song not found')
    }

    const song: SubsonicSongNode = {
      id,
      parent: id,
      title: musicInfo.name || 'Unknown',
      album: musicInfo.albumName || 'Unknown',
      artist: musicInfo.singer || 'Unknown',
      isDir: false,
      coverArt: id,
      created: '2024-01-01T00:00:00',
      duration: parseDurationToSeconds(musicInfo.interval),
      bitRate: 320,
      size: 10485760,
      suffix: 'mp3',
      contentType: 'audio/mpeg',
      isVideo: false,
      path: `${musicInfo.singer || 'Unknown'}/${musicInfo.albumName || 'Unknown'}/${musicInfo.name || 'Unknown'}.mp3`,
      albumId: id,
    }

    return respond(request, { song }, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    })
  } catch (err) {
    logger.error('[getSong] Error:', err)
    return subsonicError(request, 0, 'Internal error')
  }
}
