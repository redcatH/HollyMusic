import { NextRequest } from 'next/server'
import { createSuccessResponse } from '@/lib/api-response'
import { requireAdmin } from '@/lib/services/user-context'
import { getSystemSetting, setSystemSetting } from '@/lib/services/system-settings'
import { parseTestSamples } from '@/lib/source-testing/types'
import { SourceTestError } from '@/lib/services/source-test-service'
import { assertTestOrigin, testBody, testRouteError } from '@/lib/server/source-test-route'

export async function GET(request: NextRequest) {
  try { await requireAdmin(request); return createSuccessResponse(await getSystemSetting('music.testSamples') || {}) }
  catch (error) { return testRouteError(error) }
}
export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request); assertTestOrigin(request)
    let samples
    try { samples = parseTestSamples(await testBody(request)) } catch { throw new SourceTestError('测试歌曲格式无效') }
    await setSystemSetting('music.testSamples', samples)
    return createSuccessResponse(samples)
  } catch (error) { return testRouteError(error) }
}
