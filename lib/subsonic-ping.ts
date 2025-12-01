import { NextRequest } from 'next/server'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import auth from '@/lib/auth'
import userModel from '@/lib/user'

export async function handlePing(request: NextRequest) {
  try {
    // Use new auth resolver (supports md5 t verification and fallback plain u)
    const authRes = await auth.resolveUserFromRequest(request)
    if (authRes.error === 'invalid_t') return auth.authFailedResponse('invalid_t')
    if (!authRes.user) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 40, message: 'Authentication required' } })
      return createSubsonicResponse(xml)
    }

    // update lastLogin timestamp for the user (best-effort)
    try {
      await userModel.updateLastLoginByUsername(authRes.user.username)
    } catch (e) {
      console.warn('[ping] update lastLogin failed', e)
    }

    const xml = formatSubsonicXML({ status: 'ok' })
    return createSubsonicResponse(xml)
  } catch (err) {
    const xml = formatSubsonicXML({
      status: 'failed',
      error: {
        code: 0,
        message: err instanceof Error ? err.message : 'A generic error occurred'
      }
    })
    return createSubsonicResponse(xml)
  }
}
