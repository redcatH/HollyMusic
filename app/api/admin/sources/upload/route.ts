import { NextRequest } from 'next/server'
import { createSuccessResponse } from '@/lib/api-response'
import { requireAdmin } from '@/lib/services/user-context'
import { createDraft, SourceTestError } from '@/lib/services/source-test-service'
import { assertTestOrigin, limitedTestBody, testRouteError } from '@/lib/server/source-test-route'

/** Upload prepares a candidate; explicit confirmation is required to register it. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request); assertTestOrigin(request)
    if (Number(request.headers.get('content-length')) > 6 * 1024 * 1024) throw new SourceTestError('上传文件过大')
    const data = await new Response(await limitedTestBody(request, 6 * 1024 * 1024), { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData()
    const file = data.get('file')
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024) throw new SourceTestError('请选择不超过 5MB 的 JS 音源脚本')
    return createSuccessResponse(await createDraft(user.id, { file: { name: file.name, content: await file.text() } }), 201)
  } catch (error) { return testRouteError(error) }
}
