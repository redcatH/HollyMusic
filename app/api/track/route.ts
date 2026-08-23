/**
 * 曲目元数据 API
 * GET /api/track?uid=<source-songmid>
 *
 * 分享链接 ?uid= 自动播放用：从 DB 反查 MusicInfo，前端 toTrack 后播放。
 * 复用 resolveMusicInfoById（与 /api/audio 同一反查路径）。
 *
 * 需登录（requireUser），未登录返回 401。未登录的分享访客由落地页承接，
 * 到达 SPA 时已被全局守卫拦截到登录页。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { resolveMusicInfoById } from '@/lib/db'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    await requireUser(request) // 未登录 → AuthError → 401

    const uid = new URL(request.url).searchParams.get('uid')
    if (!uid) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: uid', 400)
    }

    const musicInfo = await resolveMusicInfoById(uid)
    if (!musicInfo) {
      return createErrorResponse('NOT_FOUND', `找不到歌曲信息: ${uid}`, 404)
    }

    return createSuccessResponse({ uid, musicInfo })
  } catch (error) {
    if (error instanceof AuthError) {
      return createErrorResponse('UNAUTHORIZED', error.message, 401)
    }
    logger.error('[api/track] error:', error)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取曲目信息失败', 500)
  }
}
