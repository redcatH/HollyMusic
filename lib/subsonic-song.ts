import { NextRequest } from 'next/server'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'
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

/**
 * 转义 XML 特殊字符
 */
function escapeXml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleGetSongAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 50, message: 'Required parameter missing: id' }
      })
      return createSubsonicResponse(xml)
    }

    // 从数据库查询 MusicInfo（id 为 songmid）
    const musicInfo = await dbAPI.getMusicInfoBySongmid(id)
    
    if (!musicInfo) {
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 70, message: 'Song not found' }
      })
      return createSubsonicResponse(xml)
    }

    // 构造歌曲信息
    const durationSeconds = parseDurationToSeconds(musicInfo.interval)
    const songXml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.15.1">
  <song 
    id="${id}"
    parent="${id}"
    title="${escapeXml(musicInfo.name || 'Unknown')}"
    album="${escapeXml(musicInfo.albumName || 'Unknown')}"
    artist="${escapeXml(musicInfo.singer || 'Unknown')}"
    isDir="false"
    coverArt="${id}"
    created="2024-01-01T00:00:00"
    duration="${durationSeconds}"
    bitRate="320"
    size="10485760"
    suffix="mp3"
    contentType="audio/mpeg"
    isVideo="false"
    path="${escapeXml(musicInfo.singer || 'Unknown')}/${escapeXml(musicInfo.albumName || 'Unknown')}/${escapeXml(musicInfo.name || 'Unknown')}.mp3"
  />
</subsonic-response>`

    return new Response(songXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': String(Buffer.byteLength(songXml)),
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (err) {
    logger.error('[getSong] Error:', err)
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 0, message: 'Internal error' }
    })
    return createSubsonicResponse(xml)
  }
}

// 同步版本 - 保持签名一致
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleGetSong(request: NextRequest, authRes: AuthResult): Response {
  // 此函数应该在路由中被替换为异步调用
  const xml = formatSubsonicXML({
    status: 'failed',
    error: { code: 0, message: 'Internal error' }
  })
  return createSubsonicResponse(xml)
}
