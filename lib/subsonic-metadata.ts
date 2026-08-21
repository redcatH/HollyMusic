import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'
import { type AuthResult } from './auth'
import * as dbAPI from './db'
import { logger } from './logger'
import { fetchLyricForMusic } from './services/lyrics'
import type { MusicInfo } from './types/music'

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

    // 封面 id 统一为 source-{songmid}；Musiver 会给封面 id 拼 al- 前缀，去掉后按歌曲查。
    // ar- 为歌手封面（暂无独立封面源），直接返回默认图。
    let musicInfo = null

    try {
      if (id.startsWith('ar-')) {
        return serveDefaultCoverArt()
      }
      const coverId = id.startsWith('al-') ? id.slice(3) : id
      musicInfo = await dbAPI.resolveMusicInfoById(coverId)
      if (!musicInfo) return serveDefaultCoverArt()
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

/**
 * 统一的歌词获取（原生精确接口优先，第三方 API 回退）。供 getLyrics / getLyricsBySongId 复用。
 * 复用歌词 service，确保 Web 与 Subsonic 的音源优先级、结构化 JSON 兼容和回退策略一致。
 */
async function fetchLyric(musicInfo: MusicInfo): Promise<{ lyric: string; tlyric: string | null } | null> {
  return fetchLyricForMusic(musicInfo)
}

// 异步版本 - 供路由中调用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleGetLyricsAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    // 传统 Subsonic getLyrics 使用 artist + title；为已有客户端兼容保留 id 查询。
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const requestedArtist = url.searchParams.get('artist')?.trim() || ''
    const requestedTitle = url.searchParams.get('title')?.trim() || ''

    const musicInfo = id
      ? await dbAPI.resolveMusicInfoById(id)
      : requestedArtist && requestedTitle
        ? await dbAPI.getFirstMusicInfoByArtistAndTitle(requestedArtist, requestedTitle)
        : null
    
    if (!musicInfo) {
      return createLegacyLyricsResponse()
    }

    const { name, singer } = musicInfo
    const artist = singer || ''
    const title = name || ''

    // 统一走 fetchLyric（音源优先，第三方 API 回退）
    const lyric = await fetchLyric(musicInfo)

    if (!lyric) {
      return createLegacyLyricsResponse()
    }

    return createLegacyLyricsResponse(artist, title, lyric.lyric, 86400)
  } catch (err) {
    logger.error('[getLyrics] Error:', err)
    const xml = formatSubsonicXML({
      status: 'failed',
      error: { code: 50, message: 'Internal server error' }
    })
    return createSubsonicResponse(xml)
  }
}

/** 传统 getLyrics 的标准响应：歌词正文必须位于 lyrics.value，而非自定义 line 节点。 */
function createLegacyLyricsResponse(artist = '', title = '', value = '', cacheMaxAge = 3600): Response {
  const children = value
    ? `<lyrics artist="${escapeXml(artist)}" title="${escapeXml(title)}" value="${escapeXml(value)}"/>`
    : '<lyrics/>'
  const xml = formatSubsonicXML({ status: 'ok', children })

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Content-Length': String(Buffer.byteLength(xml)),
      'Cache-Control': `public, max-age=${cacheMaxAge}`,
    },
  })
}

// 同步版本 - 保持 handleGetLyrics 签名一致（内部调用异步，但返回 Response）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleGetLyrics(request: NextRequest, authRes: AuthResult): Response {
  // 注：此函数应该在路由中被替换为异步调用
  // 临时返回固定响应，避免签名不匹配
  return createLegacyLyricsResponse()
}

/**
 * 构造一个 structuredLyrics XML 节点（OpenSubsonic getLyricsBySongId 用）。
 * 有时间戳 → synced="true"，行带 start；无时间戳 → synced="false"，纯文本行。
 * 返回 null 表示无可输出内容。
 */
function buildStructuredLyrics(
  lrcText: string,
  parsed: ParsedLrc,
  lang: string,
  artist: string,
  title: string,
): string | null {
  const offsetAttr = parsed.offset ? ` offset="${parsed.offset}"` : ''
  let linesXml: string
  let synced: string

  if (parsed.lines.length > 0) {
    synced = 'true'
    linesXml = parsed.lines.map(l => `      <line start="${l.time}">${escapeXml(l.text)}</line>`).join('\n')
  } else {
    const textLines = lrcText.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean)
    if (textLines.length === 0) return null
    synced = 'false'
    linesXml = textLines.map(l => `      <line>${escapeXml(l)}</line>`).join('\n')
  }

  return `    <structuredLyrics lang="${escapeXml(lang)}" displayArtist="${escapeXml(artist)}" displayTitle="${escapeXml(title)}"${offsetAttr} synced="${synced}">\n${linesXml}\n    </structuredLyrics>`
}

/** 构造一个空 lyricsList 的 subsonic 响应（查不到歌曲或歌词时用，不崩客户端） */
function emptyLyricsListResponse(cacheMaxAge = 3600): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1">\n  <lyricsList/>\n</subsonic-response>`
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Content-Length': String(Buffer.byteLength(xml)),
      'Cache-Control': `public, max-age=${cacheMaxAge}`
    }
  })
}

/**
 * 处理 getLyricsBySongId 请求（OpenSubsonic 结构化歌词）。
 * 返回 lyricsList，含原文（synced）和可选翻译（tlyric，第二语言）。
 * 查不到歌曲或歌词时返回空 lyricsList。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleGetLyricsBySongIdAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 10, message: 'Missing required parameter: id' } })
      return createSubsonicResponse(xml)
    }

    const musicInfo = await dbAPI.resolveMusicInfoById(id)
    if (!musicInfo) return emptyLyricsListResponse()

    const lyric = await fetchLyric(musicInfo)
    if (!lyric || !lyric.lyric) return emptyLyricsListResponse()

    const artist = musicInfo.singer || ''
    const title = musicInfo.name || ''

    const parsed = parseLrc(lyric.lyric)
    const main = buildStructuredLyrics(lyric.lyric, parsed, 'zho', artist, title)

    // 翻译歌词的确切语种未知，按 OpenSubsonic 约定标记为 und（未指定）。
    let trans = ''
    if (lyric.tlyric && lyric.tlyric.trim()) {
      trans = buildStructuredLyrics(lyric.tlyric, parseLrc(lyric.tlyric), 'und', artist, title) || ''
    }

    const structured = [main, trans].filter(Boolean).join('\n')
    if (!structured) return emptyLyricsListResponse()

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1">\n  <lyricsList>\n${structured}\n  </lyricsList>\n</subsonic-response>`
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Content-Length': String(Buffer.byteLength(xml)),
        'Cache-Control': 'public, max-age=86400'
      }
    })
  } catch (err) {
    logger.error('[getLyricsBySongId] Error:', err)
    const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: 'Internal server error' } })
    return createSubsonicResponse(xml)
  }
}

/** 将 interval（"mm:ss" / "h:mm:ss" / 数字）解析为秒 */
function parseIntervalToSeconds(interval: string | number | undefined): number {
  if (!interval) return 0
  if (typeof interval === 'number') return interval
  const parts = String(interval).split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + (parts[1] || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
  const n = Number(interval)
  return isNaN(n) ? 0 : n
}

/**
 * 处理 getAlbum 请求 — 返回专辑详情及其歌曲列表。
 * id 为 source-{songmid}（专辑内任一首歌）：查这首歌拿 albumId，再查同专辑所有歌。
 * 专辑 id 用代表曲（id asc 第一首）的 source-{songmid}；song 的 albumId/coverArt 统一为自身 source-{songmid}。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleGetAlbumAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 10, message: 'Missing required parameter: id' } })
      return createSubsonicResponse(xml)
    }

    // 查一首歌拿 albumId（id 为 source-{songmid}）
    const anySong = await dbAPI.resolveMusicInfoById(id)
    if (!anySong || !anySong.albumId) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 70, message: 'Album not found' } })
      return createSubsonicResponse(xml)
    }

    const albumId = String(anySong.albumId)
    const songs = await dbAPI.getMusicInfoListByAlbumId(albumId)
    if (songs.length === 0) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 70, message: 'Album not found' } })
      return createSubsonicResponse(xml)
    }

    // 代表曲 = 第一首（id asc），专辑 id 用它的 source-{songmid}
    const rep = songs[0]
    const repSongmid = dbAPI.getStorageSongmidForMusicInfo(rep)
    const albumEntryId = `${rep.source}-${repSongmid}`
    const albumName = rep.albumName || ''
    const albumArtist = rep.singer || ''
    const created = new Date().toISOString().replace('T', ' ').substring(0, 19)

    const songNodes = songs.map((s, idx) => {
      const songId = `${s.source}-${dbAPI.getStorageSongmidForMusicInfo(s)}`
      const duration = parseIntervalToSeconds(s.interval)
      const bitRate = s._types && s._types['320k'] ? 320 : (s._types && s._types['128k'] ? 128 : 0)
      return `    <song id="${escapeXml(songId)}" parent="${escapeXml(albumEntryId)}" title="${escapeXml(s.name || '')}" album="${escapeXml(albumName)}" artist="${escapeXml(s.singer || '')}" isDir="false" coverArt="${escapeXml(songId)}" duration="${duration}" bitRate="${bitRate}" track="${idx + 1}" suffix="mp3" contentType="audio/mpeg" isVideo="false" albumId="${escapeXml(songId)}" artistId="" type="music"/>`
    }).join('\n')

    const totalDuration = songs.reduce((acc, s) => acc + parseIntervalToSeconds(s.interval), 0)

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1">\n  <album id="${escapeXml(albumEntryId)}" name="${escapeXml(albumName)}" artist="${escapeXml(albumArtist)}" songCount="${songs.length}" duration="${totalDuration}" created="${created}" coverArt="${escapeXml(albumEntryId)}">\n${songNodes}\n  </album>\n</subsonic-response>`
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Content-Length': String(Buffer.byteLength(xml)),
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (err) {
    logger.error('[getAlbum] Error:', err)
    const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: 'Internal server error' } })
    return createSubsonicResponse(xml)
  }
}

/**
 * LRC 解析结果
 */
interface LrcLine { time: number; text: string }
interface ParsedLrc { offset: number; lines: LrcLine[] }

// 匹配单个时间标签：[mm:ss] / [mm:ss.xx] / [mm:ss.xxx] / [h:mm:ss.xxx]
const LRC_TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
// 全局 offset 标签：[offset:毫秒]（正数表示歌词提前）
const LRC_OFFSET_TAG = /\[offset:\s*(-?\d+)\]/i

/**
 * 将 LRC 文本解析为带时间戳的行数组（借鉴 lx-music line-player.js）。
 * - 支持一行多时间标签（如 [01:02.03][01:05.00]同一句）
 * - 解析全局 [offset:] 偏移（毫秒）
 * - 忽略 [ti:]/[ar:]/[al:]/[by:] 等 ID 标签
 * - 兼容 [mm:ss] / [mm:ss.ms] / [mm:ss.mmm]，小数部分补零到 3 位毫秒
 * - 结果按 time 升序
 */
function parseLrc(lrcText: string): ParsedLrc {
  const result: ParsedLrc = { offset: 0, lines: [] }
  if (!lrcText) return result

  const offsetMatch = LRC_OFFSET_TAG.exec(lrcText)
  if (offsetMatch) result.offset = parseInt(offsetMatch[1], 10) || 0

  const tagStrip = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g

  for (const raw of lrcText.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) continue

    LRC_TIME_TAG.lastIndex = 0
    const times: number[] = []
    let m: RegExpExecArray | null
    while ((m = LRC_TIME_TAG.exec(line)) !== null) {
      const min = parseInt(m[1], 10) || 0
      const sec = parseInt(m[2], 10) || 0
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) || 0 : 0
      times.push(min * 60000 + sec * 1000 + frac)
    }
    if (times.length === 0) continue

    const text = line.replace(tagStrip, '').trim()
    if (!text) continue

    for (const time of times) result.lines.push({ time, text })
  }

  result.lines.sort((a, b) => a.time - b.time)
  return result
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
