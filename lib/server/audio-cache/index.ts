/**
 * 音频磁盘缓存模块统一出口。
 *
 * 模块初始化（惰性，首次请求时触发）：
 * - 创建缓存根目录
 * - 清理 downloading/partial 孤儿（进程重启后无法续传的半成品）
 *
 * 调用方（route.ts）在处理请求前应 await ensureInitialized()。
 */

import { logger } from '@/lib/logger'
import { getAudioCacheConfig } from './config'
import { ensureCacheRoot } from './paths'
import { cleanupOrphans, clearAllAudioCache, collectGarbage, getCurrentBytes, maybeCollect, scanOrphanFiles, deleteOrphanFiles, scanAndCleanStale } from './lru'

export { serve } from './serve'
export type { ServeOptions } from './serve'
export { clearAllAudioCache, collectGarbage, getCurrentBytes, maybeCollect, scanOrphanFiles, deleteOrphanFiles, scanAndCleanStale }
export type { OrphanFile } from './lru'
export { getAudioCacheConfig } from './config'
export { getStats } from './repository'

let initPromise: Promise<void> | null = null

async function doInit(): Promise<void> {
  const cfg = getAudioCacheConfig()
  if (!cfg.enabled) {
    logger.info('[AudioCache] 已禁用（ENABLE_FILE_CACHE=false），将流式透传上游')
    return
  }

  await ensureCacheRoot()
  const orphanCount = await cleanupOrphans()

  logger.info(
    `[AudioCache] 初始化完成 | 目录=${cfg.cacheDir} | 配额=${(cfg.quotaBytes / 1024 / 1024 / 1024).toFixed(1)}GB | ` +
    `并发上限=${cfg.maxConcurrent} | 水位线=${(cfg.watermarkHigh * 100).toFixed(0)}%/${(cfg.watermarkLow * 100).toFixed(0)}% | ` +
    `卡死阈值=${(cfg.staleDownloadMs / 60000).toFixed(0)}分钟 | 扫描时间=凌晨${cfg.scanHour}点 | ` +
    `job超时=${(cfg.jobMaxLifetimeMs / 60000).toFixed(0)}分钟 | readiness超时=${(cfg.readinessTimeoutMs / 1000).toFixed(0)}秒` +
    (orphanCount > 0 ? ` | 清理孤儿=${orphanCount}` : '')
  )

  // 每天凌晨 scanHour 点扫描：清理卡死下载 + 幽灵记录 + 孤儿文件
  scheduleNextScan(cfg.scanHour)
}

/** 计算到下一个 scanHour 点的毫秒数，setTimeout 执行后递归 */
function scheduleNextScan(scanHour: number): void {
  const now = new Date()
  const next = new Date(now)
  next.setHours(scanHour, 0, 0, 0)
  // 如果今天已过 scanHour，设为明天
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  const delay = next.getTime() - now.getTime()

  const timer = setTimeout(() => {
    scanAndCleanStale().catch(e => {
      logger.error('[AudioCache] 凌晨扫描失败:', e)
    }).finally(() => {
      scheduleNextScan(scanHour)
    })
  }, delay)
  if (timer.unref) timer.unref()
  logger.debug(`[AudioCache] 下次扫描: ${next.toLocaleString('zh-CN')} (${Math.round(delay / 60000)}分钟后)`)
}

/** 惰性初始化（幂等，多次调用返回同一个 Promise） */
export function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch(e => {
      // 初始化失败不缓存 Promise，允许重试
      initPromise = null
      logger.error('[AudioCache] 初始化失败:', e)
      throw e
    })
  }
  return initPromise
}
