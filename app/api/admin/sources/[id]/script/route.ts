import { NextRequest } from 'next/server'
import { createErrorResponse } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { buildContentDisposition } from '@/lib/server/download-utils'
import { getSourceScript, SourceConfigError } from '@/lib/services/source-manager-service'
import { requireAdmin, AuthError, ForbiddenError } from '@/lib/services/user-context'

/** 下载当前已安装版本，不拉取或执行上游脚本。 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireAdmin(request)
    const { id } = await context.params
    const { content, filename } = await getSourceScript(id)
    return new Response(new Uint8Array(content), { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': buildContentDisposition(filename),
      'Content-Length': String(content.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
    if (error instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', error.message, 403)
    if (error instanceof SourceConfigError) return createErrorResponse('INVALID_PARAMS', error.message, error.statusCode)
    if (error instanceof Error && error.message.includes('找不到')) return createErrorResponse('NOT_FOUND', error.message, 404)
    logger.error('[admin/sources/script] 下载失败', { error: error instanceof Error ? error.name : 'unknown' })
    return createErrorResponse('INTERNAL_ERROR', '下载音源脚本失败', 500)
  }
}
