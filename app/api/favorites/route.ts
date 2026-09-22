/**
 * 收藏 API
 * GET    /api/favorites?limit=&offset=   收藏列表
 * POST   /api/favorites  body {id}       收藏
 * DELETE /api/favorites?id=              取消收藏
 */

import { NextRequest } from 'next/server'
import { createSuccessResponse, createErrorResponse, ErrorCodes } from '@/lib/api-response'
import { requireUser, AuthError } from '@/lib/services/user-context'
import { listFavoriteSongs, starSong, unstarSong } from '@/lib/services/favorites-service'
import { logger } from '@/lib/logger'

/** 单页上限：防止 limit=100000 之类的请求拖垮富化查询；store 全量同步按 500/页翻页 */
const MAX_PAGE_SIZE = 500
const DEFAULT_PAGE_SIZE = 200

/**
 * 解析并校验 limit/offset 分页参数。
 * 非法值（非整数、超范围）返回 null，由调用方回 400；不合法值绝不落进 Prisma take/skip。
 */
function parsePagination(searchParams: URLSearchParams): { limit: number; offset: number } | null {
  let limit = DEFAULT_PAGE_SIZE
  let offset = 0

  const limitRaw = searchParams.get('limit')
  if (limitRaw !== null && limitRaw !== '') {
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) return null
    limit = n
  }

  const offsetRaw = searchParams.get('offset')
  if (offsetRaw !== null && offsetRaw !== '') {
    const n = Number(offsetRaw)
    if (!Number.isInteger(n) || n < 0) return null
    offset = n
  }

  return { limit, offset }
}

function authGuard(err: unknown) {
  if (err instanceof AuthError) return createErrorResponse('UNAUTHORIZED', err.message, 401)
  return null
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const page = parsePagination(request.nextUrl.searchParams)
    if (!page) {
      return createErrorResponse(
        ErrorCodes.INVALID_PARAMS,
        `分页参数无效：limit 需为 1~${MAX_PAGE_SIZE} 的整数，offset 需为非负整数`,
        400
      )
    }
    const data = await listFavoriteSongs(user.id, page)
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/favorites GET] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '获取收藏失败', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const body = await request.json().catch(() => ({}))
    const id = body?.id
    if (!id) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: id', 400)
    const data = await starSong(user.id, String(id))
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/favorites POST] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '收藏失败', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request)
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return createErrorResponse(ErrorCodes.INVALID_PARAMS, '缺少必填参数: id', 400)
    const data = await unstarSong(user.id, id)
    return createSuccessResponse(data)
  } catch (err) {
    const guard = authGuard(err)
    if (guard) return guard
    logger.error('[api/favorites DELETE] error:', err)
    return createErrorResponse(ErrorCodes.INTERNAL_ERROR, '取消收藏失败', 500)
  }
}
