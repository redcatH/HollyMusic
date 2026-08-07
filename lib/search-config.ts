/**
 * 搜索源配置
 * 从 config/music-sources.json 读取各音源声明的支持平台 (pt)，
 * 取所有 enabled 音源的 pt 去重并集作为搜索平台列表。
 * 文件不存在或未声明 pt 时回退默认全部平台。
 */

import fs from 'fs'
import path from 'path'

/** 默认搜索平台（全部） */
export const DEFAULT_SEARCH_SOURCES = ['tx', 'wy', 'kw', 'kg', 'mg']

const CONFIG_PATH = path.resolve(process.cwd(), 'config/music-sources.json')

// mtime 缓存，避免 hot path 频繁读盘 + parse
let cachedSources: string[] | null = null
let cachedMtime = 0

/**
 * 读取参与搜索的平台列表。
 * = config/music-sources.json 中所有 enabled 音源的 pt 去重并集；
 * 为空（未配置 / 文件缺失 / 解析失败）则返回默认全部平台。
 * 任何异常都不会抛出，保证搜索不受配置读取影响。
 */
export function getSearchSources(): string[] {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return [...DEFAULT_SEARCH_SOURCES]
    }

    const mtime = fs.statSync(CONFIG_PATH).mtimeMs
    if (cachedSources && mtime === cachedMtime) {
      return cachedSources
    }

    const content = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const cfg = JSON.parse(content) as {
      sources?: Array<{ enabled?: boolean; priority?: number; pt?: unknown }>
    }

    const sourcesArr = Array.isArray(cfg.sources) ? cfg.sources : []

    // 按 priority 升序处理，保证并集顺序稳定（优先级高的音源其平台排前）
    const enabled = sourcesArr
      .filter(s => s && s.enabled === true)
      .slice()
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))

    const merged: string[] = []
    const seen = new Set<string>()
    for (const s of enabled) {
      if (!Array.isArray(s.pt)) continue
      for (const p of s.pt) {
        if (typeof p !== 'string') continue
        const trimmed = p.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        merged.push(trimmed)
      }
    }

    cachedSources = merged.length > 0 ? merged : [...DEFAULT_SEARCH_SOURCES]
    cachedMtime = mtime
    return cachedSources
  } catch {
    // 任何异常回退默认，不抛出，不影响搜索
    return [...DEFAULT_SEARCH_SOURCES]
  }
}

/**
 * AI 协助建歌单的搜索深度：每个关键词、每个音源取前 N 条候选。
 * 环境变量 AI_PLAYLIST_SEARCH_LIMIT 控制，默认 3。
 * 不做代码层去重/截断——版本与重复判定全交 AI（filter 规则4）。
 * 调大召回更多版本但 AI 处理量/token 上升；调小则每源贡献版本变少。
 */
export function getSearchLimit(): number {
  const n = Number(process.env.AI_PLAYLIST_SEARCH_LIMIT)
  return Number.isInteger(n) && n > 0 ? n : 3
}

/**
 * AI 协助建歌单 filter 的安全上限：单次请求最多接受的候选歌曲条数。
 * 环境变量 AI_PLAYLIST_FILTER_MAX_SONGS 控制，默认 1500。
 * 覆盖正常流程最大量（count 上限 50 × 5源 × AI_PLAYLIST_SEARCH_LIMIT），同时防恶意直接调 API 烧 token/爆 context。
 */
export function getFilterMaxSongs(): number {
  const n = Number(process.env.AI_PLAYLIST_FILTER_MAX_SONGS)
  return Number.isInteger(n) && n > 0 ? n : 1500
}
