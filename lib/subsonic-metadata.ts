import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'
import { type AuthResult } from './auth'
import * as dbAPI from './db'
import { logger } from './logger'
import { musicSourceManager } from './music-source-manager'

// 原生封面获取模块（参考 lx-music 各源 pic 实现），替代黑盒脚本与第三方聚合 API
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getPic: getPicNative } = require('./music-core/music-pic')

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleCoverArtAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    // 获取请求中的 id 参数
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    
    if (!id) {
      // 如果没有 id，直接返回默认图片
      return serveDefaultCoverArt()
    }

    // 判断 id 类型：song / album (prefix `al-`) / artist (prefix `ar-`)
    let musicInfo = null

    try {
      if (id.startsWith('al-')) {
        const albumId = id.slice(3)
        if (!albumId) return serveDefaultCoverArt()
        // 从数据库中查找该专辑的第一首歌
        musicInfo = await dbAPI.getFirstMusicInfoByAlbumId(albumId)
        if (!musicInfo) return serveDefaultCoverArt()
      } else if (id.startsWith('ar-')) {
        // 歌手类型暂不实现，直接返回默认封面
        // 未来可实现：根据 artist id 查找代表曲目或专辑封面
        return serveDefaultCoverArt()
      } else {
        // 默认按歌曲 id 处理（song id 为 `source-songmid` 复合格式，或旧版纯 songmid）
        musicInfo = await dbAPI.resolveMusicInfoById(id)
        if (!musicInfo) return serveDefaultCoverArt()
      }
    } catch (err) {
      logger.warn('[handleCoverArtAsync] DB lookup failed:', err)
      return serveDefaultCoverArt()
    }

    // 通过原生音源模块获取封面 URL（参考 lx-music 各源 pic 实现）
    // 优先级：DB 已存的 img(wy/mg) → 拼 URL(tx) → 实时请求(kw/kg)
    try {
      const picUrl = await getPicNative(musicInfo)
      if (picUrl) {
        const fetched = await fetchImageFromUrl(picUrl)
        if (fetched) return fetched
      }
    } catch (err) {
      logger.debug('[handleCoverArtAsync] getPic failed:', err)
    }

    return serveDefaultCoverArt()
  } catch (err) {
    logger.error('[getCoverArt] Error:', err)
    // 出错时也返回默认图片
    return serveDefaultCoverArt()
  }
}

// 同步版本 - 保持签名一致
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleCoverArt(request: NextRequest, authRes: AuthResult): Response {
  // 此函数应该在路由中被替换为异步调用
  return serveDefaultCoverArt()
}

/**
 * 返回默认封面图片
 */
function serveDefaultCoverArt(): Response {
  try {
    const coverPath = resolve(process.cwd(), 'public/icons/404.png')
    const buffer = readFileSync(coverPath)
    
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=86400'
      }
    })
  } catch (err) {
    logger.warn('[serveDefaultCoverArt] Error reading default cover:', err)
    // 如果默认图片也不存在，返回 XML 错误
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 70, message: 'Cover art not found' }
    })
    return createSubsonicResponse(xml)
  }
}

/**
 * 从 URL 获取图片
 */
async function fetchImageFromUrl(imageUrl: string): Promise<Response | null> {
  try {
    console.log('[fetchImageFromUrl] Fetching image from URL:', imageUrl)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(imageUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      redirect: 'follow'
    })
    
    clearTimeout(timeoutId)

    if (!response.ok) {
      logger.warn('[fetchImageFromUrl] Failed to fetch image, status:', response.status)
      return null
    }

    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.startsWith('image/')) {
      logger.warn('[fetchImageFromUrl] Response is not an image, Content-Type:', contentType)
      return null
    }

    const buffer = await response.arrayBuffer()
    
    if (!buffer || buffer.byteLength === 0) {
      logger.warn('[fetchImageFromUrl] Empty image response')
      return null
    }

    console.log('[fetchImageFromUrl] Got image, size:', buffer.byteLength)
    
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=86400'
      }
    })
  } catch (err) {
    logger.warn('[fetchImageFromUrl] Error fetching image:', err)
    return null
  }
}

// 异步版本 - 供路由中调用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleGetLyricsAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    // 获取请求中的 id 和可选参数
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    
    if (!id) {
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 10, message: 'Missing required parameter: id' }
      })
      return createSubsonicResponse(xml)
    }

    // 根据 id 获取 MusicInfo（song id 为 `source-songmid` 复合格式，或旧版纯 songmid）
    const musicInfo = await dbAPI.resolveMusicInfoById(id)
    
    if (!musicInfo) {
      // 无歌词
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.15.1">
  <lyrics>
    <artist></artist>
    <title></title>
    <line time="0">无歌词</line>
  </lyrics>
</subsonic-response>`
      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': String(Buffer.byteLength(xml)),
          'Cache-Control': 'public, max-age=3600'
        }
      })
    }

    const { name, singer, albumName } = musicInfo
    const artist = singer || ''
    const title = name || ''

    // 1) 优先尝试通过已加载的本地音源获取歌词
    let lyricsText: string | null = null
    try {
      lyricsText = await musicSourceManager.getLyric(musicInfo, 5000)
    } catch (err) {
      logger.debug('[handleGetLyricsAsync] musicSourceManager.getLyric failed:', err)
      lyricsText = null
    }

    // 2) 若本地音源无歌词，则调用第三方歌词 API: https://api.lrc.cx/lyrics
    if (!lyricsText) {
      lyricsText = await fetchLyricsFromAPI(title, albumName || title, artist)
    }
    
    if (!lyricsText) {
      // 无歌词
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.15.1">
  <lyrics>
    <artist>${escapeXml(artist)}</artist>
    <title>${escapeXml(title)}</title>
    <line time="0">无歌词</line>
  </lyrics>
</subsonic-response>`
      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': String(Buffer.byteLength(xml)),
          'Cache-Control': 'public, max-age=3600'
        }
      })
    }

    // 将 LRC 格式歌词转换为 Subsonic XML 格式
    const lyricsXmlLines = parseLrcToXml(lyricsText)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.15.1">
  <lyrics>
    <artist>${escapeXml(artist)}</artist>
    <title>${escapeXml(title)}</title>
${lyricsXmlLines}
  </lyrics>
</subsonic-response>`

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': String(Buffer.byteLength(xml)),
        'Cache-Control': 'public, max-age=86400'
      }
    })
  } catch (err) {
    logger.error('[getLyrics] Error:', err)
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 50, message: 'Internal server error' }
    })
    return createSubsonicResponse(xml)
  }
}

// 同步版本 - 保持 handleGetLyrics 签名一致（内部调用异步，但返回 Response）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleGetLyrics(request: NextRequest, authRes: AuthResult): Response {
  // 注：此函数应该在路由中被替换为异步调用
  // 临时返回固定响应，避免签名不匹配
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.15.1">
  <lyrics>
    <artist></artist>
    <title></title>
    <line time="0">无歌词</line>
  </lyrics>
</subsonic-response>`
  
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml',
      'Content-Length': String(Buffer.byteLength(xml)),
      'Cache-Control': 'public, max-age=3600'
    }
  })
}

/**
 * 调用第三方歌词 API 获取 LRC 格式歌词
 * API 参数说明：
 * - title: 歌曲标题
 * - album: 专辑名称
 * - artist: 作者
 * 
 * 优先级：title > album > artist
 * 只传一个参数到 API
 */
async function fetchLyricsFromAPI(title: string, album: string, artist: string): Promise<string | null> {
  try {
    // 构建参数对象 - 按优先级只传一个参数
    const params: Record<string, string> = {}
    
    const titleTrimmed = title.trim()
    const albumTrimmed = album.trim()
    const artistTrimmed = artist.trim()
    
    // 优先级：title > album > artist
    if (titleTrimmed) {
      params.title = titleTrimmed
    } else if (albumTrimmed && albumTrimmed !== '[Unknown Album]') {
      params.album = albumTrimmed
    } else if (artistTrimmed) {
      params.artist = artistTrimmed
    } else {
      // 没有有效参数
      return null
    }
    
    const searchParams = new URLSearchParams(params)
    const url = `https://api.lrc.cx/lyrics?${searchParams.toString()}`
    
    logger.info('[fetchLyricsFromAPI] Fetching from:', url)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5秒超时

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    
    clearTimeout(timeoutId)

    if (!response.ok) {
      logger.warn('[fetchLyricsFromAPI] API returned status:', response.status)
      return null
    }

    const text = await response.text()
    
    if (!text || text.trim().length === 0) {
      logger.warn('[fetchLyricsFromAPI] Empty response from API')
      return null
    }

    logger.info('[fetchLyricsFromAPI] Got lyrics, length:', text.length)
    return text
  } catch (err) {
    logger.warn('[fetchLyricsFromAPI] Error fetching lyrics:', err)
    return null
  }
}

/**
 * 将 LRC 格式歌词解析为 Subsonic XML 行格式
 * LRC 格式: [时间戳]歌词文本
 * 时间戳格式: [mm:ss.ms] 或 [mm:ss]
 */
function parseLrcToXml(lrcText: string): string {
  const lines: string[] = []
  
  try {
    const lrcLines = lrcText.split('\n')
    
    for (const line of lrcLines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) continue
      
      // 匹配 LRC 时间戳格式: [mm:ss.ms] 或 [mm:ss]
      const timeMatch = trimmedLine.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)/)
      
      if (!timeMatch) continue
      
      const minutes = parseInt(timeMatch[1], 10)
      const seconds = parseInt(timeMatch[2], 10)
      const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0'), 10) : 0
      const lyricText = timeMatch[4] || ''
      
      // 转换为毫秒
      const timeMs = minutes * 60000 + seconds * 1000 + milliseconds
      
      if (lyricText.trim()) {
        lines.push(`    <line time="${timeMs}">${escapeXml(lyricText)}</line>`)
      }
    }
  } catch (err) {
    logger.warn('[parseLrcToXml] Error parsing LRC:', err)
  }
  
  // 如果没有解析出任何行，返回占位符
  if (lines.length === 0) {
    lines.push(`    <line time="0">无歌词</line>`)
  }
  
  return lines.join('\n')
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
