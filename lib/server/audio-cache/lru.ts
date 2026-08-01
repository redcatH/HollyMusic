/**
 * LRU 清理 + 启动孤儿清理。
 *
 * 水位线策略：
 * - 缓存占用达 watermarkHigh（默认 80%）→ 触发清理
 * - 清理到 watermarkLow（默认 70%）→ 停止
 * - partial 优先淘汰（无法续传，复用价值低）
 * - 同状态内按 lastAccessAt 升序（最久未访问先删）
 *
 * 孤儿清理（启动时）：
 * - 进程重启后，downloading/partial 的 .tmp 无法续传，全部清理
 * - complete 的正式文件保留（有效缓存）
 */

import fsp from 'fs/promises'
import { logger } from '@/lib/logger'
import { getAudioCacheConfig } from './config'
import { absoluteFromRelative } from './paths'
import {
  listAll,
  listByStatus,
  deleteRecord,
  type AudioCacheRecord,
} from './repository'

/** 当前缓存占用字节（complete 按 size，partial 按 downloadedBytes；downloading 不计） */
export async function getCurrentBytes(): Promise<number> {
  const records = await listAll()
  let total = 0
  for (const r of records) {
    if (r.status === 'complete') total += r.size ?? 0
    else if (r.status === 'partial') total += r.downloadedBytes
  }
  return total
}

/**
 * 检查水位线，必要时触发清理。
 * 返回清理掉的字节数（0 表示未触发）。
 */
export async function maybeCollect(): Promise<number> {
  const cfg = getAudioCacheConfig()
  const current = await getCurrentBytes()
  const highWatermark = cfg.quotaBytes * cfg.watermarkHigh

  if (current < highWatermark) return 0

  const target = cfg.quotaBytes * cfg.watermarkLow
  logger.info(
    `[LRU] 触发清理: current=${formatBytes(current)} >= high=${formatBytes(highWatermark)}, target=${formatBytes(target)}`
  )
  return collectGarbage(target)
}

/**
 * 执行清理，直到总占用 <= targetBytes 或候选耗尽。
 * 返回清理掉的字节数。
 */
export async function collectGarbage(targetBytes: number): Promise<number> {
  const records = await listAll()
  // partial 优先 + lastAccessAt 升序
  const candidates = records
    .filter(r => r.status === 'partial' || r.status === 'complete')
    .sort((a, b) => {
      const sa = a.status === 'partial' ? 0 : 1
      const sb = b.status === 'partial' ? 0 : 1
      if (sa !== sb) return sa - sb
      return a.lastAccessAt.getTime() - b.lastAccessAt.getTime()
    })

  let currentBytes = await getCurrentBytes()
  let deleted = 0

  for (const rec of candidates) {
    if (currentBytes <= targetBytes) break

    const bytes = rec.status === 'complete' ? (rec.size ?? 0) : rec.downloadedBytes
    const ok = await deleteCacheFiles(rec)
    if (ok) {
      await deleteRecord(rec.cacheKey)
      currentBytes -= bytes
      deleted += bytes
      logger.debug(
        `[LRU] 删除 ${rec.cacheKey} (${rec.status}, ${formatBytes(bytes)})`
      )
    }
  }

  if (deleted > 0) {
    logger.info(`[LRU] 清理完成: 释放 ${formatBytes(deleted)}, 剩余 ${formatBytes(currentBytes)}`)
  }
  return deleted
}

/**
 * 启动孤儿清理：删除所有 downloading/partial 记录及其 .tmp 文件。
 * 进程重启时调用（无并发连接在读，安全）。
 */
export async function cleanupOrphans(): Promise<number> {
  const orphans = [
    ...(await listByStatus('downloading')),
    ...(await listByStatus('partial')),
  ]

  if (orphans.length === 0) return 0

  logger.info(`[LRU] 启动孤儿清理: ${orphans.length} 条 downloading/partial 记录`)
  let deleted = 0

  for (const rec of orphans) {
    const ok = await deleteCacheFiles(rec)
    if (ok) {
      await deleteRecord(rec.cacheKey)
      deleted++
    }
  }

  logger.info(`[LRU] 孤儿清理完成: 删除 ${deleted}/${orphans.length} 条`)
  return deleted
}

/** 清除全部音频缓存（/api/cache/clear type=audio 调用） */
export async function clearAllAudioCache(): Promise<{ count: number; bytes: number }> {
  const records = await listAll()
  let bytes = 0
  let count = 0
  for (const rec of records) {
    const b = rec.status === 'complete' ? (rec.size ?? 0) : rec.downloadedBytes
    if (await deleteCacheFiles(rec)) {
      count++
      bytes += b
    }
  }
  logger.info(`[LRU] 全量清理: 删除 ${count} 条, 释放 ${formatBytes(bytes)}`)
  return { count, bytes }
}

/**
 * 删除一条缓存记录对应的磁盘文件（正式文件 + .tmp）。
 * 返回是否删除了至少一个文件。
 */
async function deleteCacheFiles(rec: AudioCacheRecord): Promise<boolean> {
  let removed = false
  const absPath = absoluteFromRelative(rec.filePath)
  try {
    await fsp.unlink(absPath)
    removed = true
  } catch {
    // 文件可能已被删除（Windows rename 回退或手动清理），忽略
  }
  // 同时清理可能残留的 .tmp
  try {
    await fsp.unlink(`${absPath}.tmp`)
    removed = true
  } catch {
    // 无 .tmp，忽略
  }
  return removed
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(2)}KB`
  return `${n}B`
}
