/**
 * 健康检查 API
 * GET /api/health
 */

import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { musicSourceManager } from '@/lib/music-source-manager'

export async function GET() {
  try {
    // 确保音源管理器已初始化
    if (!musicSourceManager.isInitialized()) {
      await musicSourceManager.initialize()
    }

    const healthStatus = musicSourceManager.getHealthStatus()

    const response = {
      initialized: musicSourceManager.isInitialized(),
      timestamp: new Date().toISOString(),
      sources: healthStatus,
      summary: {
        total: healthStatus.length,
        initialized: healthStatus.filter(s => s.initialized).length,
        failed: healthStatus.filter(s => s.error).length,
      },
    }

    logger.debug('健康检查完成:', response.summary)

    return createSuccessResponse(response)
  } catch (error) {
    logger.error('健康检查失败:', error)

    return createErrorResponse(
      ErrorCodes.INTERNAL_ERROR,
      error instanceof Error ? error.message : '健康检查失败',
      500,
      error instanceof Error ? error.stack : undefined
    )
  }
}
