import { NextRequest } from 'next/server'
import { getOrCreateUserByName, verifyTForUser } from './favorites'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'

export type AuthResult = {
  user: { id: number; username: string } | null
  verified: boolean // whether t was provided and verified
  error?: string
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

  // No token provided: fallback to creating/using plain username (scheme C behavior)
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

export function authFailedResponse(reason: string) {
  const xml = formatSubsonicXML({ status: 'failed', error: { code: 40, message: `Authentication failed: ${reason}` } })
  return createSubsonicResponse(xml)
}

const authApi = { resolveUserFromParams, resolveUserFromRequest, authFailedResponse }
export default authApi
