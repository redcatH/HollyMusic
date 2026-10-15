/**
 * Subsonic 歌曲媒体元数据推断（单一事实来源）
 *
 * getSong/search3 等展示歌曲声明的最高支持档位，与原格式请求的起始选档一致。
 * 指定码率或音源解析失败可能使实际播放降级，资源元数据不代表本次音频流的实测值。
 *
 * 输入适配两种形态：
 * - 反序列化后的 MusicInfo（types/_types 直接可用，search3/stream 等路径）
 * - 原始 Prisma MusicInfo 行（types/_types 藏在 data / typesJson JSON 列里，playlist entry 路径）
 *
 * 无有效音质数据时返回空对象，undefined 字段由响应渲染层自动省略——不编造数据。
 */
import type { MusicInfo, QualityInfo, QualityType } from './types/music'
import { getAvailableQualities, resolveQuality } from './quality-options'
import { normalizeSizeToBytes } from './utils'
import { parseIntervalToSeconds } from './types/player'
import { logger } from './logger'

/**
 * 音质档位 → Subsonic 展示格式。
 * suffix/contentType 与 lib/audio-serve.ts 的 mime 表、codec-support.ts 的探测一致；
 * 无损档位（flac/flac24bit）真实码率未知，省略 bitRate 而非编造近似值。
 */
export const QUALITY_FORMAT: Record<QualityType, { bitRate?: number; suffix: string; contentType: string }> = {
  '128k': { bitRate: 128, suffix: 'mp3', contentType: 'audio/mpeg' },
  '320k': { bitRate: 320, suffix: 'mp3', contentType: 'audio/mpeg' },
  flac: { suffix: 'flac', contentType: 'audio/flac' },
  flac24bit: { suffix: 'flac', contentType: 'audio/flac' },
}

export interface SubsonicMediaMeta {
  quality?: QualityType
  bitRate?: number
  /** 文件大小（字节），来自音源上报的 size（如 "8.7M"）换算 */
  size?: number
  suffix?: string
  contentType?: string
}

/** 元数据推断的输入：MusicInfo 片段或含 data/typesJson JSON 列的 Prisma 行 */
export type MediaMetaSource =
  | Partial<Pick<MusicInfo, 'types' | '_types'>>
  | { data?: unknown; typesJson?: unknown; typesMapJson?: unknown }
  | null
  | undefined

/** 从各种输入形态提取 types 数组与 _types 映射 */
function extractTypes(source: MediaMetaSource): {
  types?: QualityInfo[]
  _types?: Partial<Record<QualityType, Partial<QualityInfo>>>
} {
  if (!source || typeof source !== 'object') return {}
  const s = source as Record<string, unknown>

  // 反序列化后的 MusicInfo 形态
  if (Array.isArray(s.types)) {
    return {
      types: s.types as QualityInfo[],
      _types: (s._types ?? undefined) as Partial<Record<QualityType, Partial<QualityInfo>>>,
    }
  }

  // 原始 Prisma 行形态：data 列是完整 MusicInfo JSON
  if (typeof s.data === 'string') {
    try {
      const parsed = JSON.parse(s.data)
      if (parsed && typeof parsed === 'object') return extractTypes(parsed)
    } catch (err) {
      logger.debug('[subsonic-media] Failed to parse data JSON:', err)
    }
  }

  // 兜底：结构化 JSON 列（typesJson = JSON.stringify(types)）
  if (typeof s.typesJson === 'string') {
    try {
      const parsed = JSON.parse(s.typesJson)
      if (Array.isArray(parsed)) return { types: parsed as QualityInfo[] }
    } catch (err) {
      logger.debug('[subsonic-media] Failed to parse typesJson:', err)
    }
  }

  return {}
}

/**
 * 推断歌曲的 Subsonic 展示元数据（bitRate/size/suffix/contentType）。
 * 选择最高支持档位；未知码率不编造，实际播放可能因客户端偏好或音源故障降级。
 */
export function resolveSubsonicMediaMeta(source: MediaMetaSource): SubsonicMediaMeta {
  const { types, _types } = extractTypes(source)

  const supported = getAvailableQualities(types)
  if (supported.length === 0) return {}

  const quality = resolveQuality('flac24bit', types)
  const format = QUALITY_FORMAT[quality]
  const rawSize = _types?.[quality]?.size ?? types?.find(t => t?.type === quality)?.size
  const size = Number(normalizeSizeToBytes(rawSize)) || undefined

  return {
    quality,
    bitRate: format.bitRate,
    size,
    suffix: format.suffix,
    contentType: format.contentType,
  }
}

/**
 * 从 Prisma MusicInfo 行解析时长（秒）。
 * 优先 durationSeconds 反范式列（当前历史数据恒为 null，见 db.ts 写入的已知问题，
 * 修复后此处自动生效）；列无效时回退解析 data 列 JSON 里的 interval。
 */
export function toDurationSeconds(
  row: { durationSeconds?: number | null; data?: unknown } | null | undefined
): number {
  if (!row) return 0
  if (typeof row.durationSeconds === 'number' && row.durationSeconds > 0) return row.durationSeconds
  if (typeof row.data === 'string') {
    try {
      return parseIntervalToSeconds(JSON.parse(row.data)?.interval)
    } catch (err) {
      logger.debug('[subsonic-media] Failed to parse data JSON for duration:', err)
    }
  }
  return 0
}
