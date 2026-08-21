import { NextRequest } from 'next/server'
import { respond, subsonicError } from '@/lib/subsonic'
import auth from '@/lib/auth'
import userModel from '@/lib/user'
import { logger } from '@/lib/logger'

export async function handlePing(request: NextRequest) {
  try {
    // Use new auth resolver (supports md5 t verification and fallback plain u)
    const authRes = await auth.resolveUserFromRequest(request)
    if (authRes.error === 'invalid_t') return auth.authFailedResponse(request, 'invalid_t')
    if (!authRes.user) {
      return subsonicError(request, 40, 'Authentication required')
    }

    // update lastLogin timestamp for the user (best-effort)
    try {
      await userModel.updateLastLoginByUsername(authRes.user.username)
    } catch (e) {
      logger.warn('[ping] update lastLogin failed', e)
    }

    return respond(request, null, {
      rootAttrs: { serverVersion: 'v1.9.8', openSubsonic: true },
    })
  } catch (err) {
    return subsonicError(request, 0, err instanceof Error ? err.message : 'A generic error occurred')
  }
}
