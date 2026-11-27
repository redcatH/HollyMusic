/**
 * 歌词 service
 *
 * 独立实现（不依赖 lib/subsonic-*.ts），复用 musicSourceManager.getLyric
 * 与第三方 API（api.lrc.cx）回退。逻辑与 subsonic-metadata.ts 的私有函数保持一致。
 */

import fsp from 'fs/promises'
import path from 'path'
import { getAudioServeConfig } from '@/lib/audio-serve'
import { searchCache } from '@/lib/cache-manager'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { musicSourceManager } from '@/lib/music-source-manager'
import { VALID_QUALITIES } from '@/lib/quality-options'
import { getLyricSidecarPath, getTranslationLyricSidecarPath } from '@/lib/server/lyric-cache'
import { decodeLyricEntities } from '@/lib/server/lyric-decode'
import { normalizeStructuredLyricText } from '@/lib/server/lyric-normalize'
import { getMusicAudioCacheKeyPrefix, getMusicAudioTrackKey } from '@/lib/server/music-audio-cache-key'
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

const preciseLyricInflight = new Map<string, Promise<LyricResult | null>>()
const PRECISE_LYRIC_MISS_TTL_MS = 60_000
const LEGACY_AUDIO_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'] as const

function getAudioCacheRecords(prefix: string, qualities: readonly string[] = VALID_QUALITIES): Promise<Array<{ filePath: string }>> {
  return prisma.audioCache.findMany({
    where: { cacheKey: { in: qualities.map(quality => `${prefix}${quality}`) } },
    orderBy: { lastAccessAt: 'desc' },
    select: { filePath: true },
  })
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

async function readCachedLyric(prefix: string, cacheDir: string, qualities?: readonly string[]): Promise<LyricResult | null> {
  const records = await getAudioCacheRecords(prefix, qualities)
  for (const record of records) {
    const paths = resolveSidecarPaths(cacheDir, record.filePath)
    if (!paths) continue
    try {
      if (!(await fileExists(paths.audioPath))) continue
      const lyric = (await fsp.readFile(paths.lyricPath, 'utf-8')).trim()
      if (lyric) {
        const tlyric = await fsp.readFile(paths.translationPath, 'utf-8').catch(() => '')
        return { lyric, tlyric: tlyric.trim() || null }
      }
    } catch {
      // 文件不可用时继续检查其他音质。
    }
  }
  return null
}

async function getCachedNativeLyric(musicInfo: MusicInfo, trackKey: string): Promise<LyricResult | null> {
  const config = getAudioServeConfig()
  if (!config.enabled) return null

  try {
    let cached = await readCachedLyric(getMusicAudioCacheKeyPrefix(trackKey), config.cacheDir)
    // 旧版酷狗使用 Audioid 写缓存键，同一 Audioid 可能对应多个版本。
    if (!cached && musicInfo.source !== 'kg') {
      cached = await readCachedLyric(`${trackKey}:`, config.cacheDir, LEGACY_AUDIO_QUALITIES)
    }
    if (cached) logger.debug('[lyrics] disk cache hit', { trackKey })
    return cached
  } catch (err) {
    logger.debug('[lyrics] disk cache read failed', { trackKey, err })
  }
  return null
}

async function persistNativeLyric(trackKey: string, lyric: LyricResult): Promise<void> {
  const config = getAudioServeConfig()
  if (!config.enabled) return

  try {
    const records = await getAudioCacheRecords(getMusicAudioCacheKeyPrefix(trackKey))
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

    logger.info('[lyrics] cached precise source lyric to disk', { trackKey })
  } catch (err) {
    // 歌词缓存失败不应影响播放或正常的歌词响应。
    logger.warn('[lyrics] disk cache write failed', { trackKey, err })
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

async function fetchPreciseLyric(musicInfo: MusicInfo): Promise<LyricResult | null> {
  const trackKey = getMusicAudioTrackKey(musicInfo)
  const running = preciseLyricInflight.get(trackKey)
  if (running) return running
  const missKey = `lyrics:precise-miss:${trackKey}`
  const task = (async () => {
    const cached = await getCachedNativeLyric(musicInfo, trackKey)
    if (cached) return cached
    if (searchCache.get(missKey) === true) return null

    // 原生接口优先，渠道音源脚本兜底。两者均按曲目标识取词。
    const result = normalizeLyricResult(await fetchNativeLyric(musicInfo))
      ?? await fetchSourceLyric(musicInfo)
    if (result) {
      await persistNativeLyric(trackKey, result)
    } else {
      searchCache.set(missKey, true, PRECISE_LYRIC_MISS_TTL_MS)
    }
    return result
  })().finally(() => preciseLyricInflight.delete(trackKey))
  preciseLyricInflight.set(trackKey, task)
  return task
}

/**
 * 从已配置的渠道音源脚本取词。脚本调用携带当前 source + MusicInfo，
 * 结果可作为渠道内歌词缓存；不包含按标题搜索的公共 API 回退。
 */
async function fetchSourceLyric(musicInfo: MusicInfo): Promise<LyricResult | null> {
  try {
    return normalizeLyricResult(await musicSourceManager.getLyric(musicInfo, 5000))
  } catch (err) {
    logger.debug('[lyrics] musicSourceManager.getLyric failed:', err)
    return null
  }
}

/** 音频缓存可用时触发，按曲目标识补齐精确歌词。 */
export async function cacheNativeLyricForMusic(musicInfo: MusicInfo): Promise<void> {
  await fetchPreciseLyric(musicInfo)
}

function normalizeLyricResult(result: LyricResult | null): LyricResult | null {
  if (!result?.lyric) return null
  const lyric = normalizeLyricPayload(result.lyric)
  if (!lyric) return null
  return { lyric, tlyric: result.tlyric ? normalizeLyricPayload(result.tlyric) || null : null }
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

  const preciseLyric = await fetchPreciseLyric(musicInfo)
  if (preciseLyric) return preciseLyric

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
