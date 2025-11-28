import { NextRequest } from 'next/server'
import {
  parseSubsonicParams,
  validateSubsonicAuth,
  formatSubsonicXML,
  createSubsonicResponse
} from '@/lib/subsonic'

export async function handlePing(request: NextRequest) {
  try {
    const params = parseSubsonicParams(request)
    const authResult = validateSubsonicAuth(params)
console.log("登录成功! {authResult}", authResult)
    if (!authResult.valid) {
      const xml = formatSubsonicXML({
        status: 'failed',
        error: {
          code: authResult.code!,
          message: authResult.message!
        }
      })
      const result = createSubsonicResponse(xml)
      return result
    }
    console.log("登录成功!", params.u)
    const xml = formatSubsonicXML({ status: 'ok' })
    console.log("登录成功!", xml)
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
