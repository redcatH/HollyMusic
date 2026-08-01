/**
 * AudioCache 表数据访问层。
 *
 * 所有 Prisma 操作集中于此，便于测试 mock 与统一错误处理。
 * 复用 lib/db.ts 的全局 Prisma 单例，避免多连接。
 */

import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

export type AudioCacheStatus = 'downloading' | 'complete' | 'partial'

export interface AudioCacheRecord {
  id: number
  cacheKey: string
  filePath: string
  size: number | null
  downloadedBytes: number
  status: AudioCacheStatus
  contentType: string | null
  quality: string
  uid: string
  lastAccessAt: Date
  createdAt: Date
  updatedAt: Date
}

function toRecord(row: {
  id: number
  cacheKey: string
  filePath: string
  size: number | null
  downloadedBytes: number
  status: string
  contentType: string | null
  quality: string
  uid: string
  lastAccessAt: Date
  createdAt: Date
  updatedAt: Date
}): AudioCacheRecord {
  return { ...row, status: row.status as AudioCacheStatus }
}

/** 按 cacheKey 获取记录 */
export async function getAudioCache(cacheKey: string): Promise<AudioCacheRecord | null> {
  try {
    const row = await prisma.audioCache.findUnique({ where: { cacheKey } })
    return row ? toRecord(row) : null
  } catch (e) {
    logger.error(`[AudioCacheRepo] getAudioCache failed: ${cacheKey}`, e)
    return null
  }
}

/**
 * 创建一条 downloading 记录。若已存在则覆盖（含旧 complete 重新下载场景）。
 * 返回写入后的记录。
 */
export async function upsertDownloading(
  cacheKey: string,
  relativeFilePath: string,
  quality: string,
  uid: string,
  contentType: string | null = null
): Promise<AudioCacheRecord> {
  const row = await prisma.audioCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      filePath: relativeFilePath,
      quality,
      uid,
      contentType,
      status: 'downloading',
      downloadedBytes: 0,
      size: null,
    },
    update: {
      filePath: relativeFilePath,
      contentType,
      status: 'downloading',
      downloadedBytes: 0,
      size: null,
      // 重新下载时刷新访问时间
      lastAccessAt: new Date(),
    },
  })
  return toRecord(row)
}

/** 增量更新下载进度（边下边播水位线依据） */
export async function updateProgress(
  cacheKey: string,
  downloadedBytes: number,
  size?: number | null,
  contentType?: string | null
): Promise<void> {
  const data: Record<string, unknown> = { downloadedBytes }
  if (size !== undefined) data.size = size
  if (contentType !== undefined) data.contentType = contentType
  try {
    await prisma.audioCache.update({ where: { cacheKey }, data })
  } catch {
    // 记录可能已被 LRU 清理删除；进度更新丢失可接受
    logger.debug(`[AudioCacheRepo] updateProgress miss (likely evicted): ${cacheKey}`)
  }
}

/** 更新文件路径（DownloadJob 拿到 contentType 修正扩展名后调用） */
export async function updateFilePath(cacheKey: string, filePath: string): Promise<void> {
  try {
    await prisma.audioCache.update({ where: { cacheKey }, data: { filePath } })
  } catch {
    // 记录可能已被删除，忽略
  }
}

/** 标记为完成 */
export async function markComplete(
  cacheKey: string,
  size: number | null,
  contentType: string | null
): Promise<void> {
  try {
    await prisma.audioCache.update({
      where: { cacheKey },
      data: { status: 'complete', downloadedBytes: size ?? 0, size, contentType },
    })
  } catch (e) {
    logger.error(`[AudioCacheRepo] markComplete failed: ${cacheKey}`, e)
  }
}

/** 标记为 partial（上游中断，无法续传，保留已下载字节供读） */
export async function markPartial(cacheKey: string, downloadedBytes: number): Promise<void> {
  try {
    await prisma.audioCache.update({
      where: { cacheKey },
      data: { status: 'partial', downloadedBytes },
    })
  } catch (e) {
    logger.error(`[AudioCacheRepo] markPartial failed: ${cacheKey}`, e)
  }
}

/** 刷新访问时间（serve 命中时调用，LRU 依据） */
export async function touchAccess(cacheKey: string): Promise<void> {
  try {
    await prisma.audioCache.update({
      where: { cacheKey },
      data: { lastAccessAt: new Date() },
    })
  } catch {
    // 记录可能已被删除，忽略
  }
}

/** 按状态列出记录 */
export async function listByStatus(status: AudioCacheStatus): Promise<AudioCacheRecord[]> {
  const rows = await prisma.audioCache.findMany({ where: { status } })
  return rows.map(toRecord)
}

/**
 * LRU 候选列表：按 lastAccessAt 升序。
 * partial 优先淘汰（无法续传，复用价值低）。
 */
export async function listLruCandidates(limit: number): Promise<AudioCacheRecord[]> {
  const rows = await prisma.audioCache.findMany({
    where: { status: { in: ['partial', 'complete'] } },
    orderBy: [
      // partial 排在前（先淘汰）
      { status: 'asc' },
      // 同状态内按访问时间升序
      { lastAccessAt: 'asc' },
    ],
    take: limit,
  })
  // status asc: 'complete' < 'downloading' < 'partial'，partial 在后。
  // 我们要 partial 在前，故自定义排序。
  return rows
    .map(toRecord)
    .sort((a, b) => {
      const sa = a.status === 'partial' ? 0 : 1
      const sb = b.status === 'partial' ? 0 : 1
      if (sa !== sb) return sa - sb
      return a.lastAccessAt.getTime() - b.lastAccessAt.getTime()
    })
}

/** 全部记录（用于统计/清理） */
export async function listAll(): Promise<AudioCacheRecord[]> {
  const rows = await prisma.audioCache.findMany()
  return rows.map(toRecord)
}

/** 删除单条记录（不删文件，文件由调用方清理） */
export async function deleteRecord(cacheKey: string): Promise<void> {
  try {
    await prisma.audioCache.delete({ where: { cacheKey } })
  } catch {
    // 已不存在，忽略
  }
}

/** 批量删除记录 */
export async function deleteMany(cacheKeys: string[]): Promise<void> {
  if (cacheKeys.length === 0) return
  try {
    await prisma.audioCache.deleteMany({ where: { cacheKey: { in: cacheKeys } } })
  } catch (e) {
    logger.error('[AudioCacheRepo] deleteMany failed', e)
  }
}

/** 清空全部记录 */
export async function clearAll(): Promise<number> {
  const result = await prisma.audioCache.deleteMany({})
  return result.count
}

/** 统计：各状态记录数与占用字节 */
export async function getStats(): Promise<{
  total: number
  downloading: number
  complete: number
  partial: number
  totalBytes: number
}> {
  const [all, downloading, complete, partial, agg] = await Promise.all([
    prisma.audioCache.count(),
    prisma.audioCache.count({ where: { status: 'downloading' } }),
    prisma.audioCache.count({ where: { status: 'complete' } }),
    prisma.audioCache.count({ where: { status: 'partial' } }),
    prisma.audioCache.aggregate({ _sum: { size: true } }),
  ])
  return {
    total: all,
    downloading,
    complete,
    partial,
    totalBytes: agg._sum.size ?? 0,
  }
}
