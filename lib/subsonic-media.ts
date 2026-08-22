/**
 * Subsonic 歌曲媒体元数据推断（单一事实来源）
 *
 * 背景：stream 实际播放音质由客户端 maxBitRate + 回退链动态决定，而 getSong/search3 等
 * 元数据端点没有请求上下文，只能按「默认播放档位」展示——即复用 stream 的同一条
 * selectQuality 回退链（客户端不传 maxBitRate 时目标为 320k），保证
 * 「客户端显示的码率/格式」=「不主动请求无损时实际听到的」。
 *
 * 输入适配两种形态：
 * - 反序列化后的 MusicInfo（types/_types 直接可用，search3/stream 等路径）
 * - 原始 Prisma MusicInfo 行（types/_types 藏在 data / typesJson JSON 列里，playlist entry 路径）
 *
 * 无有效音质数据时返回空对象，undefined 字段由响应渲染层自动省略——不编造数据。
 */
import type { MusicInfo, QualityInfo, QualityType } from './types/music'
import { QUALITY_ORDER } from './quality-options'
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

/**
 * 播放音质回退选择（自 subsonic-stream.ts 迁出的唯一实现，stream 与元数据端点共用，
 * 保证展示档位与实际播放永远同一条链）。
 * - 请求档位受支持 → 直接用
 * - 否则按 flac24bit → flac → 320k → 128k 从高到低取第一个支持的（可能高于请求档）
 * - 全不支持（异常数据）→ 第一个可用（调用方需保证列表非空）
 */
export function selectQuality(requestedQuality: QualityType, supportedTypes: QualityType[]): QualityType {
  if (supportedTypes.includes(requestedQuality)) {
    return requestedQuality
  }

  for (const q of QUALITY_ORDER) {
    if (supportedTypes.includes(q)) {
      logger.debug(`[selectQuality] Requested ${requestedQuality} not available, downgrading to ${q}`)
      return q
    }
  }

  logger.warn(`[selectQuality] No matching quality found, using first available: ${supportedTypes[0]}`)
  return supportedTypes[0]
}

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
 * 档位 = selectQuality('320k', 支持列表)，与 stream 默认播放路径一致。
 */
export function resolveSubsonicMediaMeta(source: MediaMetaSource): SubsonicMediaMeta {
  const { types, _types } = extractTypes(source)

  const supported = (types || [])
    .map(t => t?.type)
    .filter((t): t is QualityType => !!t && QUALITY_ORDER.includes(t))
  if (supported.length === 0) return {}

  const quality = selectQuality('320k', supported)
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
