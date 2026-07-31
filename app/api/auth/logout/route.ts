/**
 * 登出 API
 * POST /api/auth/logout
 *
 * 清除 holly_user + holly_sig cookie。
 */

import { createSuccessResponse } from '@/lib/api-response'
import { clearSessionCookies } from '@/lib/services/auth'

export async function POST() {
  const res = createSuccessResponse({ ok: true })
  for (const c of clearSessionCookies()) {
    res.cookies.set(c.name, c.value, c)
  }
  return res
}
