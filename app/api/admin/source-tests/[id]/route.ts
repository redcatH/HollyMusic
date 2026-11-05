import { after, NextRequest } from 'next/server'
import { createSuccessResponse } from '@/lib/api-response'
import { requireAdmin } from '@/lib/services/user-context'
import { cancelTest, commitDraft, discardDraft, getDraft, prepareTest, SourceTestError } from '@/lib/services/source-test-service'
import { assertTestOrigin, testBody, testRouteError } from '@/lib/server/source-test-route'

type Context = { params: Promise<{ id: string }> }
export const maxDuration = 900
export async function GET(request: NextRequest, context: Context) {
  try { const user = await requireAdmin(request); return createSuccessResponse(await getDraft((await context.params).id, user.id)) }
  catch (error) { return testRouteError(error) }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await requireAdmin(request); assertTestOrigin(request)
    const { id } = await context.params
    const body = await testBody(request)
    switch (body.action) {
      case 'run': {
        if (body.mode !== 'quick' && body.mode !== 'full') throw new SourceTestError('检测模式无效')
        if (body.keys !== undefined && (!Array.isArray(body.keys) || body.keys.some(key => typeof key !== 'string'))) throw new SourceTestError('测试项无效')
        const run = await prepareTest(id, user.id, body.mode, body.keys as string[] | undefined)
        after(run)
        return createSuccessResponse(await getDraft(id, user.id), 202)
      }
      case 'cancel': await cancelTest(id, user.id); return createSuccessResponse({ ok: true })
      case 'commit': return createSuccessResponse(await commitDraft(id, user.id, {
        pt: body.pt as string[], enabled: body.enabled as boolean, priority: body.priority as number | undefined,
      }))
      default: throw new SourceTestError('操作无效')
    }
  } catch (error) { return testRouteError(error) }
}
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const user = await requireAdmin(request); assertTestOrigin(request)
    await discardDraft((await context.params).id, user.id)
    return createSuccessResponse({ ok: true })
  } catch (error) { return testRouteError(error) }
}
