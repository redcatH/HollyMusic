import { after, NextRequest } from 'next/server'
import { createSuccessResponse } from '@/lib/api-response'
import { requireAdmin } from '@/lib/services/user-context'
import { createDraft, getDraft, recentDrafts, startSourceTest, SourceTestError } from '@/lib/services/source-test-service'
import { assertTestOrigin, testBody, testRouteError } from '@/lib/server/source-test-route'

export const maxDuration = 900

export async function GET(request: NextRequest) {
  try {
    const user = await requireAdmin(request)
    const [list, pending] = await Promise.all([recentDrafts(user.id), recentDrafts(user.id, 'pending')])
    return createSuccessResponse({ list, pending })
  }
  catch (error) { return testRouteError(error) }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request); assertTestOrigin(request)
    const body = await testBody(request)
    if (typeof body.sourcePath !== 'string') throw new SourceTestError('请选择待测试音源')
    if (body.action === 'run') {
      if (body.mode !== 'quick' && body.mode !== 'full') throw new SourceTestError('检测模式无效')
      if (typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.hash)) throw new SourceTestError('音源快照无效，请重新打开测试窗口')
      if (body.keys !== undefined && (!Array.isArray(body.keys) || body.keys.some(key => typeof key !== 'string'))) throw new SourceTestError('测试项无效')
      const { id, run } = await startSourceTest(user.id, body.sourcePath, body.hash, body.mode, body.keys as string[] | undefined)
      after(run)
      return createSuccessResponse(await getDraft(id, user.id), 202)
    }
    return createSuccessResponse(await createDraft(user.id, { sourcePath: body.sourcePath, update: body.update === true, preview: body.preview === true }), 201)
  } catch (error) { return testRouteError(error) }
}
