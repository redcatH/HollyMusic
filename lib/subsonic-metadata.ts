import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { respond, subsonicError, TEXT_KEY, type SubsonicPayload } from './subsonic'
import { type AuthResult } from './auth'
import * as dbAPI from './db'
import { logger } from './logger'
import { musicSourceManager } from './music-source-manager'
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
      return serveDefaultCoverArt(request)
    }

    // 封面 id 统一为 source-{songmid}；Musiver 会给封面 id 拼 al- 前缀，去掉后按歌曲查。
    // ar- 为歌手封面（暂无独立封面源），直接返回默认图。
    let musicInfo = null

    try {
      if (id.startsWith('ar-')) {
        return serveDefaultCoverArt(request)
      }
      const coverId = id.startsWith('al-') ? id.slice(3) : id
      musicInfo = await dbAPI.resolveMusicInfoById(coverId)
      if (!musicInfo) return serveDefaultCoverArt(request)
    } catch (err) {
      logger.warn('[handleCoverArtAsync] DB lookup failed:', err)
      return serveDefaultCoverArt(request)
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

    return serveDefaultCoverArt(request)
  } catch (err) {
    logger.error('[getCoverArt] Error:', err)
    // 出错时也返回默认图片
    return serveDefaultCoverArt(request)
  }
}

/**
 * 返回默认封面图片
 */
function serveDefaultCoverArt(request: NextRequest): Response {
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
    return subsonicError(request, 70, 'Cover art not found')
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
 * 统一的歌词获取（音源优先，第三方 API 回退）。供 getLyrics / getLyricsBySongId 复用。
 * 返回 { lyric, tlyric } 或 null。
 */
async function fetchLyric(musicInfo: MusicInfo): Promise<{ lyric: string; tlyric: string | null } | null> {
  const title = musicInfo.name || ''
  const artist = musicInfo.singer || ''
  const album = musicInfo.albumName || ''

  // 1) 优先音源
  try {
    const result = await musicSourceManager.getLyric(musicInfo, 5000)
    if (result && result.lyric && result.lyric.trim()) return result
  } catch (err) {
    logger.debug('[fetchLyric] musicSourceManager.getLyric failed:', err)
  }

  // 2) 回退第三方 API
  const text = await fetchLyricsFromAPI(title, album || title, artist)
  if (text && text.trim()) return { lyric: text.trim(), tlyric: null }

  return null
}

// 异步版本 - 供路由中调用
export async function handleGetLyricsAsync(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    // 获取请求中的 id 和可选参数
    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return subsonicError(request, 10, 'Missing required parameter: id')
    }

    // 根据 id 获取 MusicInfo（song id 为 `source-songmid` 复合格式，或旧版纯 songmid）
    const musicInfo = await dbAPI.resolveMusicInfoById(id)

    const artist = musicInfo?.singer || ''
    const title = musicInfo?.name || ''

    // 统一走 fetchLyric（音源优先，第三方 API 回退）；查无歌曲或无歌词均返回"无歌词"占位
    const lyric = musicInfo ? await fetchLyric(musicInfo) : null

    const payload: SubsonicPayload = {
      lyrics: {
        artist: { [TEXT_KEY]: artist },
        title: { [TEXT_KEY]: title },
        line: parseLrcToLines(lyric?.lyric),
      },
    }

    return respond(request, payload, {
      headers: { 'Cache-Control': lyric ? 'public, max-age=86400' : 'public, max-age=3600' },
    })
  } catch (err) {
    logger.error('[getLyrics] Error:', err)
    return subsonicError(request, 50, 'Internal server error')
  }
}

/**
 * 构造一个 structuredLyrics 节点对象（OpenSubsonic getLyricsBySongId 用）。
 * 有时间戳 → synced=true，行带 start；无时间戳 → synced=false，纯文本行。
 * 返回 null 表示无可输出内容。
 */
function buildStructuredLyrics(
  lrcText: string,
  parsed: ParsedLrc,
  lang: string,
  artist: string,
  title: string,
  album: string
): SubsonicPayload | null {
  let line: SubsonicPayload[]
  let synced: boolean

  if (parsed.lines.length > 0) {
    synced = true
    line = parsed.lines.map(l => ({ start: l.time, [TEXT_KEY]: l.text }))
  } else {
    const textLines = lrcText.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean)
    if (textLines.length === 0) return null
    synced = false
    line = textLines.map(l => ({ [TEXT_KEY]: l }))
  }

  return {
    lang,
    displayArtist: artist,
    displayTitle: title,
    albumName: album,
    offset: parsed.offset || undefined,
    synced,
    line,
  }
}

/** 构造一个空 lyricsList 的 subsonic 响应（查不到歌曲或歌词时用，不崩客户端） */
function emptyLyricsListResponse(request: NextRequest, cacheMaxAge = 3600): Response {
  return respond(request, { lyricsList: {} }, {
    headers: { 'Cache-Control': `public, max-age=${cacheMaxAge}` },
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
      return subsonicError(request, 10, 'Missing required parameter: id')
    }

    const musicInfo = await dbAPI.resolveMusicInfoById(id)
    if (!musicInfo) return emptyLyricsListResponse(request)

    const lyric = await fetchLyric(musicInfo)
    if (!lyric || !lyric.lyric) return emptyLyricsListResponse(request)

    const artist = musicInfo.singer || ''
    const title = musicInfo.name || ''
    const album = musicInfo.albumName || ''

    const parsed = parseLrc(lyric.lyric)
    const main = buildStructuredLyrics(lyric.lyric, parsed, 'zh', artist, title, album)

    // 翻译歌词作为第二语言（tlyric 语种不确定，暂标 en）
    let trans: SubsonicPayload | null = null
    if (lyric.tlyric && lyric.tlyric.trim()) {
      trans = buildStructuredLyrics(lyric.tlyric, parseLrc(lyric.tlyric), 'en', artist, title, album)
    }

    const structured = [main, trans].filter((v): v is SubsonicPayload => !!v)
    if (structured.length === 0) return emptyLyricsListResponse(request)

    return respond(request, { lyricsList: { structuredLyrics: structured } }, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    })
  } catch (err) {
    logger.error('[getLyricsBySongId] Error:', err)
    return subsonicError(request, 0, 'Internal server error')
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
      return subsonicError(request, 10, 'Missing required parameter: id')
    }

    // 查一首歌拿 albumId（id 为 source-{songmid}）
    const anySong = await dbAPI.resolveMusicInfoById(id)
    if (!anySong || !anySong.albumId) {
      return subsonicError(request, 70, 'Album not found')
    }

    const albumId = String(anySong.albumId)
    const songs = await dbAPI.getMusicInfoListByAlbumId(albumId)
    if (songs.length === 0) {
      return subsonicError(request, 70, 'Album not found')
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
      return {
        id: songId,
        parent: albumEntryId,
        title: s.name || '',
        album: albumName,
        artist: s.singer || '',
        isDir: false,
        coverArt: songId,
        duration,
        bitRate,
        track: idx + 1,
        suffix: 'mp3',
        contentType: 'audio/mpeg',
        isVideo: false,
        albumId: songId,
        artistId: '',
        type: 'music',
      }
    })

    const totalDuration = songs.reduce((acc, s) => acc + parseIntervalToSeconds(s.interval), 0)

    return respond(request, {
      album: {
        id: albumEntryId,
        name: albumName,
        artist: albumArtist,
        songCount: songs.length,
        duration: totalDuration,
        created,
        coverArt: albumEntryId,
        song: songNodes,
      },
    }, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    })
  } catch (err) {
    logger.error('[getAlbum] Error:', err)
    return subsonicError(request, 0, 'Internal server error')
  }
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
 * 将 LRC 格式歌词解析为 Subsonic 行节点（传统 getLyrics 用，向后兼容）。
 * 基于 parseLrc，输出 <line time="毫秒">文本</line>；无可解析内容时返回"无歌词"占位行。
 */
function parseLrcToLines(lrcText?: string | null): SubsonicPayload[] {
  try {
    if (lrcText) {
      const parsed = parseLrc(lrcText)
      if (parsed.lines.length > 0) {
        return parsed.lines.map(l => ({ time: l.time, [TEXT_KEY]: l.text }))
      }
    }
  } catch (err) {
    logger.warn('[parseLrcToLines] Error parsing LRC:', err)
  }
  return [{ time: 0, [TEXT_KEY]: '无歌词' }]
}
