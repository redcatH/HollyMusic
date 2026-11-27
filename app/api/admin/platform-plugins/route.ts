import { NextRequest } from 'next/server'
import { createErrorResponse, createSuccessResponse } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import { MAX_PLUGIN_BYTES } from '@/lib/platform-plugins'
import { PluginError, record } from '@/lib/server/platform-plugin-contract'
import { changePluginBindings, deletePlatformPlugin, getPluginAdminView, testPlatformPlugin, uploadPlatformPlugin } from '@/lib/services/platform-plugin-service'
import { AuthError, ForbiddenError, requireAdmin } from '@/lib/services/user-context'

function failure(error: unknown) {
  if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof PluginError) {
    return createErrorResponse('PLATFORM_PLUGIN_ERROR', error.message, error instanceof PluginError ? error.status : error.statusCode)
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'P2002' || code === 'P2034' || code === 'P1008') {
    return createErrorResponse('PLATFORM_PLUGIN_CONFLICT', '检测到并发修改，请刷新后台后重试', 409)
  }
  if (code === 'P2021' || code === 'P2022') {
    logger.error('[platform-plugins] database schema is out of date', { code })
    return createErrorResponse('PLATFORM_PLUGIN_MIGRATION_REQUIRED', '平台插件数据库结构需要更新，请在服务端应用数据库迁移后重试', 503)
  }
  logger.error('[platform-plugins] management failed', { name: error instanceof Error ? error.name : 'UnknownError' })
  return createErrorResponse('INTERNAL_ERROR', '平台插件操作失败', 500)
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    return createSuccessResponse(await getPluginAdminView())
  } catch (error) { return failure(error) }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request)
    if (request.headers.get('content-type')?.startsWith('text/javascript')) {
      if (Number(request.headers.get('content-length')) > MAX_PLUGIN_BYTES) throw new PluginError('脚本超过 256 KB', 413)
      const reader = request.body?.getReader()
      const text = new TextDecoder('utf-8', { fatal: true })
      let received = 0
      let content = ''
      while (reader) {
        const { value, done } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_PLUGIN_BYTES) { await reader.cancel(); throw new PluginError('脚本超过 256 KB', 413) }
        try { content += text.decode(value, { stream: true }) }
        catch { await reader.cancel(); throw new PluginError('请上传 UTF-8 JavaScript 文件') }
      }
      try { content += text.decode() } catch { throw new PluginError('请上传 UTF-8 JavaScript 文件') }
      return createSuccessResponse(await uploadPlatformPlugin(content, user.id, request.signal), 201)
    }
    const body = record(await request.json().catch(() => null))
    if (body.action === 'test') return createSuccessResponse(await testPlatformPlugin(body, request.signal))
    if (body.action === 'apply') return createSuccessResponse(await changePluginBindings(body, user.id))
    if (body.action === 'delete') return createSuccessResponse(await deletePlatformPlugin(body, user.id))
    throw new PluginError('操作无效')
  } catch (error) { return failure(error) }
}
