import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/lib/api-response'
import { getInitializationStatus } from '@/lib/services/initialization'
import { logger } from '@/lib/logger'

/** 首装期间同时约束 Web API 与显式关闭认证的 Subsonic 入口。 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (['/api/health', '/api/auth/me', '/api/setup', '/api/site/settings', '/api/site/manifest'].includes(path)) return NextResponse.next()
  try {
    if ((await getInitializationStatus()).setupRequired) {
      return createErrorResponse('SETUP_REQUIRED', '请先在网页完成管理员设置', 428)
    }
    return NextResponse.next()
  } catch (error) {
    logger.error('[startup] 无法读取初始化状态:', error)
    return createErrorResponse('UNAVAILABLE', '服务暂时不可用，请检查数据库迁移', 503)
  }
}

export const config = { matcher: ['/api/:path*', '/rest/:path*'] }
