import { NextRequest } from 'next/server'
import { handlePing } from '@/lib/subsonic-ping'
import { handleSearch } from '@/lib/subsonic-search'
import { handleStar, handleUnstar } from '@/lib/subsonic-favorites'
import { handleCoverArtAsync, handleGetLyricsAsync } from '@/lib/subsonic-metadata'
import { handleGetSongAsync } from '@/lib/subsonic-song'
import { handleGetStarred } from '@/lib/subsonic-getstarred'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import { handleStream } from '@/lib/subsonic-stream'
import auth, { type AuthResult } from '@/lib/auth'
import configSync from '@/lib/config-sync'

// 同步启动配置中的用户（非阻塞）
configSync.syncUsersFromConfig().then(r => console.info('[startup] config-sync result', r)).catch(e => console.warn('[startup] config-sync error', e))

function normalizeMethod(raw: string | undefined) {
  if (!raw) return ''
  return raw.replace(/\.view$/i, '')
}

/**
 * 认证检查：如果 method 需要认证但用户未登录，返回认证失败响应
 */
function checkAuthRequired(method: string, authRes: AuthResult): Response | null {
  const envList = parseListParam(process.env.REQUIRE_AUTH ?? null)
  const defaultList = ['star', 'unstar', 'stream', 'getSong', 'getStarred']
  const requireList = envList.length ? envList : defaultList
  const requireAuthSet = new Set(requireList)

  if (requireAuthSet.has(method) && !authRes.user) {
    return auth.authFailedResponse('Authentication required')
  }
  return null
}

/**
 * 如果认证失败（token 无效），返回认证失败响应
 */
function checkAuthError(authRes: AuthResult): Response | null {
  if (authRes.error === 'invalid_t') {
    return auth.authFailedResponse('invalid_t')
  }
  return null
}

async function handleMethod(request: NextRequest, method: string) {
  // 统一入口：进行一次性认证
  const authRes = await auth.resolveUserFromRequest(request)
  
  // 检查认证错误（token 无效）
  const authError = checkAuthError(authRes)
  if (authError) return authError
  
  // 检查 method 是否需要认证
  // const authRequired = checkAuthRequired(method, authRes)
  // if (authRequired) return authRequired

  // 分发到各个 handler，传递 authRes 避免重复查询
  switch (method) {
    case 'ping':
      return handlePing(request)
    case 'search3':
      return handleSearch(request)
    case 'stream':
      return handleStream(request)
    case 'star':
      return handleStar(request, authRes)
    case 'unstar':
      return handleUnstar(request, authRes)
    case 'getCoverArt':
      // 使用异步版本获取封面（支持数据库查询和 API 调用）
      return handleCoverArtAsync(request, authRes)
    case 'getLyrics':
      // 使用异步版本获取歌词（支持数据库查询和 API 调用）
      return handleGetLyricsAsync(request, authRes)
    case 'getSong':
      // 使用异步版本获取歌曲信息（从数据库直接查询）
      return handleGetSongAsync(request, authRes)
    case 'getStarred':
      return handleGetStarred(request, authRes)
    default: {
      // console.log("404 url", method)
      // return new Response(null, {
      //   status: 404
      // })
      // 返回 subsonic 风格的 404/未找到响应
      console.log("error: Method not found:", method)
      const xml = formatSubsonicXML({
        status: 'failed',
        error: { code: 70, message: `Method not found: ${method}` }
      })
      return createSubsonicResponse(xml)
    }
  }
}

function parseListParam(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
}

export async function GET(request: NextRequest, context: { params: Promise<Record<string, string> | undefined> }) {
  // In Next 16 params is a Promise — unwrap it before use
  const params = await context.params
  const raw = params?.method
  const method = normalizeMethod(raw)

  // 打印参数日志，便于调试
  console.log('[rest] params:', params, 'raw:', raw, 'method:', method, 'requestUrl:', request.url)

  return handleMethod(request, method)
}

// export async function POST(request: NextRequest, context: { params: Promise<Record<string, string> | undefined> }) {
//   return GET(request, context)
// }

// export async function HEAD(request: NextRequest, context: { params: Promise<Record<string, string> | undefined> }) {
//   const params = await context.params
//   const raw = params?.method
//   const method = normalizeMethod(raw)

//   const response = await handleMethod(request, method, raw)
  
//   // HEAD 请求返回相同的响应头，但 body 为空
//   return new Response(null, {
//     status: response.status,
//     statusText: response.statusText,
//     headers: response.headers
//   })
// }
