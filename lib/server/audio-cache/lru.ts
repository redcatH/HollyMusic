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
import path from 'path'
import { logger } from '@/lib/logger'
import { getAudioCacheConfig } from './config'
import { absoluteFromRelative } from './paths'
import {
  listAll,
  listByStatus,
  deleteRecord,
  type AudioCacheRecord,
} from './repository'
import { jobManager } from './job-manager'

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
 * 扫描磁盘缓存目录，找出 DB 里没有对应记录的孤儿文件。
 * 场景：DB 重置 / 迁移后，磁盘上残留旧缓存文件。
 *
 * 返回孤儿文件列表（相对路径 + 绝对路径 + 字节数）。
 * 仅扫描，不删除——由 admin 在 UI 上确认后调用 deleteOrphanFiles。
 */
export interface OrphanFile {
  /** 相对于缓存根目录的路径（如 ab/abcdef.mp3） */
  relativePath: string
  /** 绝对路径 */
  absolutePath: string
  /** 文件大小（字节） */
  size: number
}

export async function scanOrphanFiles(): Promise<{ count: number; bytes: number; orphans: OrphanFile[] }> {
  const cfg = getAudioCacheConfig()
  const root = cfg.cacheDir

  // 1. 收集 DB 里所有 filePath
  const records = await listAll()
  const dbPaths = new Set(records.map(r => r.filePath))

  // 2. 递归扫描磁盘目录
  const orphans: OrphanFile[] = []
  await scanDir(root, '', dbPaths, orphans)

  const bytes = orphans.reduce((sum, o) => sum + o.size, 0)
  logger.info(`[LRU] 孤儿扫描: 发现 ${orphans.length} 个孤儿文件, 占用 ${formatBytes(bytes)}`)
  return { count: orphans.length, bytes, orphans }
}

/** 递归扫描目录，收集不在 dbPaths 中的文件 */
async function scanDir(
  rootAbs: string,
  relDir: string,
  dbPaths: Set<string>,
  orphans: OrphanFile[]
): Promise<void> {
  const absDir = relDir ? path.join(rootAbs, relDir) : rootAbs
  let entries: import('fs').Dirent[]
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true })
  } catch {
    return // 目录不存在，忽略
  }

  for (const entry of entries) {
    const relPath = relDir ? path.join(relDir, entry.name).replace(/\\/g, '/') : entry.name

    if (entry.isDirectory()) {
      await scanDir(rootAbs, relPath, dbPaths, orphans)
    } else if (entry.isFile()) {
      // 文件名可能是 abc.mp3（正式）或 abc.mp3.tmp（下载中）
      // 正式文件的 relPath 应在 dbPaths 中
      // .tmp 文件：去掉 .tmp 后缀看是否在 dbPaths（对应 partial/downloading 的 .tmp）
      if (relPath.endsWith('.tmp')) {
        const withoutTmp = relPath.slice(0, -4)
        if (!dbPaths.has(withoutTmp)) {
          // .tmp 对应的正式路径也不在 DB → 孤儿
          const abs = path.join(rootAbs, relDir, entry.name)
          const stat = await fsp.stat(abs).catch(() => null)
          if (stat) orphans.push({ relativePath: relPath, absolutePath: abs, size: stat.size })
        }
      } else {
        if (!dbPaths.has(relPath)) {
          const abs = path.join(rootAbs, relDir, entry.name)
          const stat = await fsp.stat(abs).catch(() => null)
          if (stat) orphans.push({ relativePath: relPath, absolutePath: abs, size: stat.size })
        }
      }
    }
  }
}

/** 删除指定的孤儿文件（不删 DB 记录，因为 DB 里本来就没有） */
export async function deleteOrphanFiles(
  orphans: OrphanFile[]
): Promise<{ deleted: number; bytes: number }> {
  let deleted = 0
  let bytes = 0
  for (const orphan of orphans) {
    try {
      await fsp.unlink(orphan.absolutePath)
      deleted++
      bytes += orphan.size
    } catch {
      // 文件可能已被其他进程删除，忽略
    }
  }
  logger.info(`[LRU] 孤儿删除: 清理 ${deleted}/${orphans.length} 个文件, 释放 ${formatBytes(bytes)}`)
  return { deleted, bytes }
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

/**
 * 统一扫描清理卡死/异常状态的缓存记录。
 *
 * 清理规则：
 * 1. status=downloading 且 updatedAt 距今超过 staleDownloadMs → 删记录 + 删 .tmp
 * 2. status=complete 但正式文件不存在 → 删记录（幽灵记录）
 * 3. status=partial 但 .tmp 不存在 → 删记录（幽灵记录）
 *
 * 返回清理统计。定时器 + admin 手动均调用此函数。
 */
export async function scanAndCleanStale(): Promise<{
  staleDownloads: number
  ghostRecords: number
  orphanFiles: number
  totalDeleted: number
  bytesFreed: number
}> {
  const cfg = getAudioCacheConfig()
  const now = Date.now()
  const records = await listAll()

  let staleDownloads = 0
  let ghostRecords = 0
  let bytesFreed = 0

  for (const rec of records) {
    const age = now - rec.updatedAt.getTime()

    // 1. downloading 超时 → 卡死，删记录 + 删 .tmp
    if (rec.status === 'downloading' && age > cfg.staleDownloadMs) {
      // 竞态防护：有活跃 job 则跳过（下一轮再清）
      if (jobManager.has(rec.cacheKey)) {
        logger.debug(`[stale-scan] 跳过（有活跃 job）: ${rec.cacheKey}`)
        continue
      }
      // 先删 DB 记录（新用户此后走 miss 全新下载）
      await deleteRecord(rec.cacheKey)
      // 二次检查：删记录期间可能新 job 刚创建
      if (jobManager.has(rec.cacheKey)) {
        logger.info(`[stale-scan] 删记录后发现新 job，跳过删文件: ${rec.cacheKey}`)
        staleDownloads++
        continue
      }
      // 安全删 .tmp
      await deleteCacheFiles(rec)
      staleDownloads++
      bytesFreed += rec.downloadedBytes
      logger.info(`[stale-scan] 清理卡死下载: ${rec.cacheKey} (age=${Math.round(age / 1000)}s)`)
      continue
    }

    // 2. complete 但文件不存在 → 幽灵记录
    if (rec.status === 'complete') {
      const abs = absoluteFromRelative(rec.filePath)
      if (!(await fileExists(abs))) {
        await deleteRecord(rec.cacheKey)
        ghostRecords++
        logger.info(`[stale-scan] 清理幽灵记录(complete): ${rec.cacheKey}`)
        continue
      }
    }

    // 3. partial 但 .tmp 不存在 → 幽灵记录
    if (rec.status === 'partial') {
      const tmpAbs = `${absoluteFromRelative(rec.filePath)}.tmp`
      if (!(await fileExists(tmpAbs))) {
        await deleteRecord(rec.cacheKey)
        ghostRecords++
        logger.info(`[stale-scan] 清理幽灵记录(partial): ${rec.cacheKey}`)
        continue
      }
    }
  }

  // 4. 扫描磁盘孤儿文件（DB 无记录的文件）
  const orphanResult = await scanOrphanFiles()
  let orphanFiles = 0
  if (orphanResult.count > 0) {
    const delResult = await deleteOrphanFiles(orphanResult.orphans)
    orphanFiles = delResult.deleted
    bytesFreed += delResult.bytes
  }

  const totalDeleted = staleDownloads + ghostRecords + orphanFiles
  if (totalDeleted > 0) {
    logger.info(
      `[stale-scan] 完成: 卡死下载=${staleDownloads} 幽灵记录=${ghostRecords} 孤儿文件=${orphanFiles} 释放=${formatBytes(bytesFreed)}`
    )
  }

  return { staleDownloads, ghostRecords, orphanFiles, totalDeleted, bytesFreed }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}
