import type { NextRequest } from 'next/server'
import { createErrorResponse } from '@/lib/api-response'
import { SourceTestError } from '@/lib/services/source-test-service'
import { SourceConfigError } from '@/lib/services/source-manager-service'
import { AuthError, ForbiddenError } from '@/lib/services/user-context'
import { logger } from '@/lib/logger'

export function assertTestOrigin(request: NextRequest): void {
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ForbiddenError('不允许跨站操作')
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== (request.headers.get('host') || request.nextUrl.host)) throw new ForbiddenError('请求来源无效')
}
export function testRouteError(error: unknown): Response {
  if (error instanceof AuthError) return createErrorResponse('UNAUTHORIZED', error.message, 401)
  if (error instanceof ForbiddenError) return createErrorResponse('FORBIDDEN', error.message, 403)
  if (error instanceof SourceTestError) return createErrorResponse('SOURCE_TEST_ERROR', error.message, error.status)
  if (error instanceof SourceConfigError) return createErrorResponse('CONFLICT', error.message, error.statusCode)
  logger.error('[source-test] 管理请求失败', { error: error instanceof Error ? error.name : 'unknown' })
  return createErrorResponse('SOURCE_TEST_ERROR', '操作失败，请稍后重试', 500)
}
export async function testBody(request: NextRequest): Promise<Record<string, unknown>> {
  const text = Buffer.from(await limitedTestBody(request, 65536)).toString('utf8')
  let data
  try { data = JSON.parse(text) } catch { throw new SourceTestError('请求格式无效') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SourceTestError('请求格式无效')
  return data
}

export async function limitedTestBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader()
  if (!reader) throw new SourceTestError('请求内容为空')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > limit) { await reader.cancel(); throw new SourceTestError('请求内容过大', 413) }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}
