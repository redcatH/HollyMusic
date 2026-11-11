import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { removeHistoryEntry } from '@/lib/services/history-service'
import { logger } from '@/lib/logger'

/** 删除当前用户的一条播放记录。不存在或不属于该用户时，返回 deleted: 0。 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request)
    const { id } = await params
    const entryId = Number(id)
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(entryId) || entryId <= 0) {
      return createErrorResponse(ErrorCodes.INVALID_PARAMS, '无效的历史记录 ID', 400)
    }
    return createSuccessResponse(await removeHistoryEntry(user.username, entryId))
  } catch (err) {
    if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
    logger.error('[api/history DELETE entry] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '删除播放记录失败', 500)
  }
}
