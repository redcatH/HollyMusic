import { NextRequest } from 'next/server'
import { createSubsonicJsonResponse, createSubsonicResponse, formatSubsonicJSON, formatSubsonicXML, wantsSubsonicJson } from '@/lib/subsonic'
import auth from '@/lib/auth'
import userModel from '@/lib/user'
import { logger } from '@/lib/logger'

function createPingResponse(
  request: NextRequest,
  status: 'ok' | 'failed',
  error?: { code: number; message: string },
): Response {
  if (wantsSubsonicJson(request)) {
    return createSubsonicJsonResponse(formatSubsonicJSON({
      status,
      error,
      attributes: status === 'ok' ? { serverVersion: 'v1.9.8', openSubsonic: true } : {},
    }))
  }

  return createSubsonicResponse(formatSubsonicXML({
    status,
    error,
    rootheader: status === 'ok' ? ' serverVersion="v1.9.8" openSubsonic="true"' : '',
  }))
}

export async function handlePing(request: NextRequest) {
  try {
    // Use new auth resolver (supports md5 t verification and fallback plain u)
    const authRes = await auth.resolveUserFromRequest(request)
    if (authRes.error === 'invalid_t') return auth.authFailedResponse('invalid_t', request)
    if (!authRes.user) {
      return createPingResponse(request, 'failed', { code: 40, message: 'Authentication required' })
    }

    // update lastLogin timestamp for the user (best-effort)
    try {
      await userModel.updateLastLoginByUsername(authRes.user.username)
    } catch (error) {
      logger.warn('[ping] update lastLogin failed', error)
    }

    return createPingResponse(request, 'ok')
  } catch (err) {
    return createPingResponse(request, 'failed', {
      code: 0,
      message: err instanceof Error ? err.message : 'A generic error occurred',
    })
  }
}
