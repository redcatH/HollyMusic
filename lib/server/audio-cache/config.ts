/**
 * 音频磁盘缓存配置。
 *
 * 所有参数均可通过环境变量覆盖。在 `.env` / docker-compose 中配置：
 * - AUDIO_CACHE_QUOTA_GB       磁盘配额（GB），达水位线触发 LRU 清理
 * - AUDIO_CACHE_MAX_CONCURRENT 同时进行的上游下载任务数上限
 * - AUDIO_CACHE_DIR            缓存根目录（Docker 建议 /app/.cache/audio-cache）
 * - AUDIO_CACHE_WATERMARK_HIGH 触发清理的占用比例（0-1）
 * - AUDIO_CACHE_WATERMARK_LOW  清理目标比例（0-1）
 * - AUDIO_CACHE_SEEK_TIMEOUT_MS seek 超过已下载部分时的等待上限（ms）
 * - ENABLE_FILE_CACHE          总开关，false 时退化为流式透传（不缓存、不支持 seek）
 */

import path from 'path'

function readInt(envVar: string, fallback: number, min = 1): number {
  const raw = process.env[envVar]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback
  return Math.max(min, n)
}

function readFloat(envVar: string, fallback: number): number {
  const raw = process.env[envVar]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return n
}

function readBool(envVar: string, fallback: boolean): boolean {
  const raw = process.env[envVar]?.toLowerCase().trim()
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export interface AudioCacheConfig {
  /** 总开关；false 时 /api/audio 退化为流式透传（无磁盘缓存、无 seek） */
  enabled: boolean
  /** 磁盘配额（字节） */
  quotaBytes: number
  /** 同时下载任务上限 */
  maxConcurrent: number
  /** 缓存根目录（绝对路径） */
  cacheDir: string
  /** 触发 LRU 清理的占用比例 */
  watermarkHigh: number
  /** LRU 清理目标比例 */
  watermarkLow: number
  /** seek 超过已下载部分时的等待上限（ms） */
  seekTimeoutMs: number
}

let cached: AudioCacheConfig | null = null

/**
 * 读取配置（惰性单例）。环境变量变更需重启进程生效，
 * 与 MusicSourceManager 的热重载不同——磁盘缓存配置属运维参数，无需热更。
 */
export function getAudioCacheConfig(): AudioCacheConfig {
  if (cached) return cached

  const quotaGb = readInt('AUDIO_CACHE_QUOTA_GB', 10, 1)
  const dir = process.env.AUDIO_CACHE_DIR?.trim() || path.resolve(process.cwd(), 'data/audio-cache')

  const high = clamp(readFloat('AUDIO_CACHE_WATERMARK_HIGH', 0.8), 0.5, 0.99)
  let low = clamp(readFloat('AUDIO_CACHE_WATERMARK_LOW', 0.7), 0.1, high - 0.05)
  if (low >= high) low = high - 0.05 // 保证 low < high

  cached = {
    enabled: readBool('ENABLE_FILE_CACHE', true),
    quotaBytes: quotaGb * 1024 * 1024 * 1024,
    maxConcurrent: readInt('AUDIO_CACHE_MAX_CONCURRENT', 5, 1),
    cacheDir: dir,
    watermarkHigh: high,
    watermarkLow: low,
    seekTimeoutMs: readInt('AUDIO_CACHE_SEEK_TIMEOUT_MS', 30000, 1000),
  }
  return cached
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/** 仅供测试重置用 */
export function _resetAudioCacheConfigForTest(): void {
  cached = null
}
