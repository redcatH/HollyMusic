import { NextRequest } from 'next/server'
import { createSuccessResponse } from '@/lib/api-response'
import { requireAdmin } from '@/lib/services/user-context'
import { createDraft, SourceTestError } from '@/lib/services/source-test-service'
import { assertTestOrigin, testBody, testRouteError } from '@/lib/server/source-test-route'

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request); assertTestOrigin(request)
    const body = await testBody(request)
    if (typeof body.url !== 'string' || !body.url.trim()) throw new SourceTestError('请输入订阅脚本直链')
    return createSuccessResponse(await createDraft(user.id, { url: body.url.trim() }), 201)
  } catch (error) { return testRouteError(error) }
}
