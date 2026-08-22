/**
 * 歌词 service
 *
 * 独立实现（不依赖 lib/subsonic-*.ts），复用 musicSourceManager.getLyric
 * 与第三方 API（api.lrc.cx）回退。逻辑与 subsonic-metadata.ts 的私有函数保持一致。
 */

import fsp from 'fs/promises'
import path from 'path'
import { getAudioServeConfig } from '@/lib/audio-serve'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { musicSourceManager } from '@/lib/music-source-manager'
import { getLyricSidecarPath, getTranslationLyricSidecarPath } from '@/lib/server/lyric-cache'
import { decodeLyricEntities } from '@/lib/server/lyric-decode'
import { normalizeStructuredLyricText } from '@/lib/server/lyric-normalize'
import { fetchNativeLyric } from '@/lib/server/music-lyric'
import type { MusicInfo } from '@/lib/types/music'

export interface ParsedLyricLine {
  time: number // 毫秒
  text: string
}
export interface ParsedLyric {
  offset: number // 毫秒
  lines: ParsedLyricLine[]
}

type LyricResult = { lyric: string; tlyric: string | null }

const nativeLyricInflight = new Map<string, Promise<LyricResult | null>>()

function getAudioCacheKeyPrefix(musicInfo: MusicInfo): string {
  return `${musicInfo.source}:${musicInfo.songmid}:`
}

function resolveSidecarPaths(
  cacheDir: string,
  relativeAudioPath: string
): { audioPath: string; lyricPath: string; translationPath: string } | null {
  const audioPath = path.resolve(cacheDir, relativeAudioPath)
  const relative = path.relative(cacheDir, audioPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return {
    audioPath,
    lyricPath: getLyricSidecarPath(audioPath),
    translationPath: getTranslationLyricSidecarPath(audioPath),
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

async function getCachedNativeLyric(musicInfo: MusicInfo): Promise<LyricResult | null> {
  const config = getAudioServeConfig()
  if (!config.enabled) return null

  try {
    const records = await prisma.audioCache.findMany({
      where: { cacheKey: { startsWith: getAudioCacheKeyPrefix(musicInfo) } },
      orderBy: { lastAccessAt: 'desc' },
      select: { filePath: true },
    })
    for (const record of records) {
      const paths = resolveSidecarPaths(config.cacheDir, record.filePath)
      if (!paths) continue
      try {
        if (!(await fileExists(paths.audioPath))) continue
        const lyric = (await fsp.readFile(paths.lyricPath, 'utf-8')).trim()
        if (lyric) {
          const tlyric = await fsp.readFile(paths.translationPath, 'utf-8').catch(() => '')
          logger.debug('[lyrics] disk cache hit', { source: musicInfo.source, songId: musicInfo.songmid })
          return { lyric, tlyric: tlyric.trim() || null }
        }
      } catch {
        // 未缓存、缓存文件被删除或内容损坏时，继续检查其他音质及网络回退。
      }
    }
  } catch (err) {
    logger.debug('[lyrics] disk cache read failed', { source: musicInfo.source, songId: musicInfo.songmid, err })
  }
  return null
}

async function persistNativeLyric(musicInfo: MusicInfo, lyric: LyricResult): Promise<void> {
  const config = getAudioServeConfig()
  if (!config.enabled) return

  try {
    const records = await prisma.audioCache.findMany({
      where: { cacheKey: { startsWith: getAudioCacheKeyPrefix(musicInfo) } },
      orderBy: { lastAccessAt: 'desc' },
      select: { filePath: true },
    })
    if (!records.length) return

    const existingPaths = (await Promise.all(records.map(async record => {
      const paths = resolveSidecarPaths(config.cacheDir, record.filePath)
      return paths && await fileExists(paths.audioPath) ? paths : null
    }))).filter((paths): paths is NonNullable<ReturnType<typeof resolveSidecarPaths>> => paths !== null)
    if (!existingPaths.length) return

    // 首次缓存只写入一份歌词，放在当前最近使用且实际存在的音频旁。
    const targetPaths = existingPaths[0]

    await writeTextAtomically(targetPaths.lyricPath, lyric.lyric)
    if (lyric.tlyric) {
      await writeTextAtomically(targetPaths.translationPath, lyric.tlyric)
    } else {
      await fsp.unlink(targetPaths.translationPath).catch(() => {})
    }

    logger.info('[lyrics] cached precise source lyric to disk', { source: musicInfo.source, songId: musicInfo.songmid })
  } catch (err) {
    // 歌词缓存失败不应影响播放或正常的歌词响应。
    logger.warn('[lyrics] disk cache write failed', { source: musicInfo.source, songId: musicInfo.songmid, err })
  }
}

async function writeTextAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tempPath, content, 'utf-8')
  try {
    await fsp.rename(tempPath, filePath)
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => {})
    throw error
  }
}

async function getNativeLyricWithDiskCache(musicInfo: MusicInfo): Promise<LyricResult | null> {
  const cached = await getCachedNativeLyric(musicInfo)
  if (cached) return cached

  const key = `${musicInfo.source}:${musicInfo.songmid}`
  const running = nativeLyricInflight.get(key)
  if (running) return running

  const task = (async () => {
    const nativeLyric = await fetchNativeLyric(musicInfo)
    if (!nativeLyric) return null
    const lyric = normalizeLyricPayload(nativeLyric.lyric)
    if (!lyric) return null
    const result = {
      lyric,
      tlyric: nativeLyric.tlyric ? normalizeLyricPayload(nativeLyric.tlyric) || null : null,
    }
    await persistNativeLyric(musicInfo, result)
    return result
  })()
  nativeLyricInflight.set(key, task)
  try {
    return await task
  } finally {
    nativeLyricInflight.delete(key)
  }
}

/**
 * 从已配置的渠道音源脚本取词。脚本调用携带当前 source + MusicInfo，
 * 结果可作为渠道内歌词缓存；不包含按标题搜索的公共 API 回退。
 */
async function getSourceLyricWithDiskCache(musicInfo: MusicInfo): Promise<LyricResult | null> {
  try {
    const result = await musicSourceManager.getLyric(musicInfo, 5000)
    if (!result?.lyric) return null

    const lyric = normalizeLyricPayload(result.lyric)
    if (!lyric) return null

    const tlyric = result.tlyric ? normalizeLyricPayload(result.tlyric) : ''
    const resolved = { lyric, tlyric: tlyric || null }
    await persistNativeLyric(musicInfo, resolved)
    return resolved
  } catch (err) {
    logger.debug('[lyrics] musicSourceManager.getLyric failed:', err)
    return null
  }
}

/** 音频完整落盘后触发：仅缓存所属渠道精确歌词，不使用标题搜索回退。 */
export async function cacheNativeLyricForMusic(musicInfo: MusicInfo): Promise<void> {
  // 仅缓存渠道唯一标识精确取得的歌词；标题搜索等第三方回退结果可能错配，
  // 可以临时返回给页面，但绝不能落盘固化。
  const cached = await getCachedNativeLyric(musicInfo)
  if (cached) return
  if (await getNativeLyricWithDiskCache(musicInfo)) return
  await getSourceLyricWithDiskCache(musicInfo)
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
export async function fetchLyricForMusic(musicInfo: MusicInfo): Promise<LyricResult | null> {
  const title = musicInfo.name || ''
  const artist = musicInfo.singer || ''
  const album = musicInfo.albumName || ''

  // 1) 平台原生接口按歌曲唯一标识取词，避免同名歌曲被标题搜索误配。
  const nativeLyric = await getNativeLyricWithDiskCache(musicInfo)
  if (nativeLyric) return nativeLyric

  // 2) 已配置的渠道音源脚本（以 source + MusicInfo 查询，可作为精确结果缓存）
  const sourceLyric = await getSourceLyricWithDiskCache(musicInfo)
  if (sourceLyric) return sourceLyric

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
