import { NextRequest } from 'next/server'
import { getOrCreateUserByName, verifyTForUser } from './favorites'
import { createSubsonicJsonResponse, createSubsonicResponse, formatSubsonicJSON, formatSubsonicXML, wantsSubsonicJson } from './subsonic'

export type AuthResult = {
  user: { id: number; username: string } | null
  verified: boolean // whether t was provided and verified
  error?: string
}

/**
 * REST 接口认证开关（REQUIRE_AUTH 环境变量）。
 *
 * - 未设置：默认开启认证（安全优先，修复匿名冒名越权）
 * - false | off | none（不区分大小写）：显式关闭（匿名模式，不推荐公网）
 * - 其它非空值：方法名列表，仅列表内方法要求认证（由调用方解析）
 */
export function isRestAuthEnabled(): boolean {
  const raw = (process.env.REQUIRE_AUTH ?? '').trim().toLowerCase()
  return raw !== 'false' && raw !== 'off' && raw !== 'none'
}

export async function resolveUserFromParams(u?: string | null, t?: string | null, s?: string | null): Promise<AuthResult> {
  const username = (u || '').trim()
  if (!username) return { user: null, verified: false, error: 'missing_username' }

  // If client provided t and s, attempt verification
  if (t && s) {
    const ok = await verifyTForUser(username, t, s)
    if (!ok) {
      return { user: null, verified: false, error: 'invalid_t' }
    }
    // verified; ensure user exists
    const user = await getOrCreateUserByName(username)
    return { user: { id: user.id, username: user.username }, verified: true }
  }

  // 认证开启：无 token 直接拒绝，不创建用户（防"传 u=xxx 即建号/冒名"）
  if (isRestAuthEnabled()) {
    return { user: null, verified: false, error: 'auth_required' }
  }

  // REQUIRE_AUTH=false 显式关闭：保留旧 fallback（仅传用户名即视为该用户）
  const user = await getOrCreateUserByName(username)
  return { user: { id: user.id, username: user.username }, verified: false }
}

export async function resolveUserFromRequest(request: NextRequest): Promise<AuthResult> {
  const url = new URL(request.url)
  const params = url.searchParams
  const u = params.get('u')
  const t = params.get('t')
  const s = params.get('s')
  return resolveUserFromParams(u, t, s)
}

export function authFailedResponse(reason: string, request?: NextRequest) {
  const error = { code: 40, message: `Authentication failed: ${reason}` }
  if (request && wantsSubsonicJson(request)) {
    return createSubsonicJsonResponse(formatSubsonicJSON({ status: 'failed', error }))
  }

  return createSubsonicResponse(formatSubsonicXML({ status: 'failed', error }))
}

const authApi = { resolveUserFromParams, resolveUserFromRequest, authFailedResponse }
export default authApi
