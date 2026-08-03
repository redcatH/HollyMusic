/**
 * 曲目元数据 API
 * GET /api/track?uid=<source-songmid>
 *
 * 分享链接 ?uid= 自动播放用：从 DB 反查 MusicInfo，前端 toTrack 后播放。
 * 复用 resolveMusicInfoById（与 /api/audio 同一反查路径）。
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { resolveMusicInfoById } from '@/lib/db'

export async function GET(request: NextRequest) {
  const uid = new URL(request.url).searchParams.get('uid')
  if (!uid) {
    return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: uid', 400)
  }

  const musicInfo = await resolveMusicInfoById(uid)
  if (!musicInfo) {
    return createErrorResponse('NOT_FOUND', `找不到歌曲信息: ${uid}`, 404)
  }

  return createSuccessResponse({ uid, musicInfo })
}
