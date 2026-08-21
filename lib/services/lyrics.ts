/**
 * 歌词 service
 *
 * 独立实现（不依赖 lib/subsonic-*.ts），复用 musicSourceManager.getLyric
 * 与第三方 API（api.lrc.cx）回退。逻辑与 subsonic-metadata.ts 的私有函数保持一致。
 */

import { musicSourceManager } from '../music-source-manager'
import { logger } from '../logger'
import { decodeLyricEntities } from '../server/lyric-decode'
import { normalizeStructuredLyricText } from '../server/lyric-normalize'
import { fetchNativeLyric } from '../server/music-lyric'
import type { MusicInfo } from '../types/music'

export interface ParsedLyricLine {
  time: number // 毫秒
  text: string
}
export interface ParsedLyric {
  offset: number // 毫秒
  lines: ParsedLyricLine[]
}

function normalizeLyricPayload(value: string): string {
  return normalizeStructuredLyricText(decodeLyricEntities(value).trim()).trim()
}

/**
 * 调用第三方歌词 API 获取 LRC 文本。
 * 优先使用 title + artist，避免同名歌曲命中错误歌词；缺失歌名时再降级使用专辑或歌手。
 */
async function fetchLyricsFromAPI(title: string, album: string, artist: string): Promise<string | null> {
  try {
    const params: Record<string, string> = {}
    const titleTrimmed = title.trim()
    const albumTrimmed = album.trim()
    const artistTrimmed = artist.trim()

    if (titleTrimmed) {
      params.title = titleTrimmed
      if (artistTrimmed) params.artist = artistTrimmed
    } else if (albumTrimmed && albumTrimmed !== '[Unknown Album]') {
      params.album = albumTrimmed
      if (artistTrimmed) params.artist = artistTrimmed
    } else if (artistTrimmed) {
      params.artist = artistTrimmed
    } else {
      return null
    }

    const url = `https://api.lrc.cx/lyrics?${new URLSearchParams(params).toString()}`
    logger.info('[lyrics] fetching from API:', url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      logger.warn('[lyrics] API returned status:', response.status)
      return null
    }

    const text = await response.text()
    if (!text || text.trim().length === 0) return null
    // 回退源同样可能返回实体编码歌词（不经过 extractLyric，此处解码）
    return decodeLyricEntities(text)
  } catch (err) {
    logger.warn('[lyrics] API error:', err)
    return null
  }
}

/**
 * 统一歌词获取：音源优先，第三方 API 回退。
 * 返回 { lyric, tlyric } 或 null。
 */
export async function fetchLyricForMusic(
  musicInfo: MusicInfo
): Promise<{ lyric: string; tlyric: string | null } | null> {
  const title = musicInfo.name || ''
  const artist = musicInfo.singer || ''
  const album = musicInfo.albumName || ''

  // 1) 平台原生接口按歌曲唯一标识取词，避免同名歌曲被标题搜索误配。
  const nativeLyric = await fetchNativeLyric(musicInfo)
  if (nativeLyric) {
    const lyric = normalizeLyricPayload(nativeLyric.lyric)
    if (lyric) {
      const tlyric = nativeLyric.tlyric ? normalizeLyricPayload(nativeLyric.tlyric) : ''
      return { lyric, tlyric: tlyric || null }
    }
  }

  // 2) 已配置的自定义音源
  try {
    const result = await musicSourceManager.getLyric(musicInfo, 5000)
    if (result?.lyric) {
      const lyric = normalizeLyricPayload(result.lyric)
      if (lyric) {
        const tlyric = result.tlyric ? normalizeLyricPayload(result.tlyric) : ''
        return { lyric, tlyric: tlyric || null }
      }
    }
  } catch (err) {
    logger.debug('[lyrics] musicSourceManager.getLyric failed:', err)
  }

  // 3) 回退第三方 API
  const text = await fetchLyricsFromAPI(title, album || title, artist)
  const lyric = text ? normalizeLyricPayload(text) : ''
  if (lyric) return { lyric, tlyric: null }

  return null
}

// 匹配单个时间标签：[mm:ss] / [mm:ss.xx] / [mm:ss.xxx] / [h:mm:ss.xxx]
const LRC_TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
// 全局 offset 标签：[offset:毫秒]（正数表示歌词提前）
const LRC_OFFSET_TAG = /\[offset:\s*(-?\d+)\]/i

/**
 * 将 LRC 文本解析为带时间戳的行数组。
 * - 支持一行多时间标签
 * - 解析全局 [offset:] 偏移（毫秒）
 * - 忽略 [ti:]/[ar:]/[al:]/[by:] 等 ID 标签
 * - 结果按 time 升序，time 单位为毫秒
 */
export function parseLrc(lrcText: string): ParsedLyric {
  const result: ParsedLyric = { offset: 0, lines: [] }
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
