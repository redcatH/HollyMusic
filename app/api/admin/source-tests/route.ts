import { NextRequest } from 'next/server'
import { createSuccessResponse } from '@/lib/api-response'
import { requireAdmin } from '@/lib/services/user-context'
import { createDraft, recentDrafts, SourceTestError } from '@/lib/services/source-test-service'
import { assertTestOrigin, testBody, testRouteError } from '@/lib/server/source-test-route'

export async function GET(request: NextRequest) {
  try { const user = await requireAdmin(request); return createSuccessResponse({ list: await recentDrafts(user.id) }) }
  catch (error) { return testRouteError(error) }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request); assertTestOrigin(request)
    const body = await testBody(request)
    if (typeof body.sourcePath !== 'string') throw new SourceTestError('请选择待测试音源')
    return createSuccessResponse(await createDraft(user.id, { sourcePath: body.sourcePath, update: body.update === true }), 201)
  } catch (error) { return testRouteError(error) }
}
