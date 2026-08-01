/**
 * 缓存管理 API（仅管理员）
 * GET  /api/admin/cache   返回内存缓存 + 磁盘缓存的统计信息
 * POST /api/admin/cache   清理缓存 { type: 'search'|'url'|'audio'|'all' }
 *
 * 两类缓存：
 * - 内存缓存（searchCache / urlCache）：进程内存，重启即清空，TTL 210 分钟自动过期
 * - 磁盘缓存（audio-cache）：持久化文件，多用户共享，LRU 自动淘汰
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse } from '@/lib/api-response'
import {
  requireAdmin,
  AuthError,
  ForbiddenError,
} from '@/lib/services/user-context'
import { searchCache, urlCache } from '@/lib/cache-manager'
import { getStats, getAudioCacheConfig, scanOrphanFiles, deleteOrphanFiles } from '@/lib/server/audio-cache'
import { clearAllAudioCache } from '@/lib/server/audio-cache'
import { logger } from '@/lib/logger'

function guard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  if (err instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', err.message, 403)
  return null
}

/** GET：返回全部缓存统计 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)

    const cfg = getAudioCacheConfig()

    // 磁盘缓存统计
    let diskStats: { total: number; downloading: number; complete: number; partial: number; totalBytes: number }
    try {
      diskStats = await getStats()
    } catch {
      // AudioCache 模块可能未初始化（如 ENABLE_FILE_CACHE=false）
      diskStats = { total: 0, downloading: 0, complete: 0, partial: 0, totalBytes: 0 }
    }

    return createSuccessResponse({
      memory: {
        search: searchCache.getStats(),
        url: urlCache.getStats(),
      },
      disk: {
        ...diskStats,
        quotaBytes: cfg.quotaBytes,
        enabled: cfg.enabled,
      },
    })
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/cache GET] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '获取缓存统计失败', 500)
  }
}

/** POST：清理指定类型缓存 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)

    const body = await request.json().catch(() => ({}))
    const { type = 'all' } = body as { type?: 'search' | 'url' | 'audio' | 'all' | 'scan-orphans' | 'clean-orphans' }

    const validTypes = ['all', 'search', 'url', 'audio', 'scan-orphans', 'clean-orphans']
    if (!validTypes.includes(type)) {
      return createErrorResponse('INVALID_PARAMS', `无效的 type: ${type}，支持: ${validTypes.join(', ')}`, 400)
    }

    const result: {
      type: string
      search?: { size: number; hits: number; misses: number; hitRate: string }
      url?: { size: number; hits: number; misses: number; hitRate: string }
      audio?: { count: number; bytes: number } | null
      orphans?: { count: number; bytes: number; files: { relativePath: string; size: number }[] }
      cleaned?: { deleted: number; bytes: number }
    } = { type }

    switch (type) {
      case 'all':
        searchCache.clear()
        urlCache.clear()
        result.audio = await clearAllAudioCache().catch(() => null)
        logger.info('[cache] admin 清理全部缓存')
        break
      case 'search':
        searchCache.clear()
        logger.info('[cache] admin 清理搜索缓存')
        break
      case 'url':
        urlCache.clear()
        logger.info('[cache] admin 清理 URL 缓存')
        break
      case 'audio':
        result.audio = await clearAllAudioCache().catch(() => null)
        logger.info('[cache] admin 清理音频磁盘缓存')
        break
      case 'scan-orphans': {
        const scanResult = await scanOrphanFiles()
        result.orphans = {
          count: scanResult.count,
          bytes: scanResult.bytes,
          files: scanResult.orphans.map(o => ({ relativePath: o.relativePath, size: o.size })),
        }
        logger.info(`[cache] admin 扫描孤儿文件: ${scanResult.count} 个`)
        break
      }
      case 'clean-orphans': {
        // 先扫描再删除（前端先 scan 展示，确认后调 clean）
        const scanResult = await scanOrphanFiles()
        const delResult = await deleteOrphanFiles(scanResult.orphans)
        result.cleaned = delResult
        logger.info(`[cache] admin 清理孤儿文件: ${delResult.deleted}/${scanResult.count} 个`)
        break
      }
    }

    // 返回清理后的统计
    result.search = searchCache.getStats()
    result.url = urlCache.getStats()

    return createSuccessResponse(result)
  } catch (err) {
    const g = guard(err)
    if (g) return g
    logger.error('[api/admin/cache POST] error:', err)
    return createErrorResponse('INTERNAL_ERROR', '清理缓存失败', 500)
  }
}
