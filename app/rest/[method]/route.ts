import { NextRequest } from 'next/server'
import { handlePing } from '@/lib/subsonic-ping'
import { handleSearch } from '@/lib/subsonic-search'
import { handleStar, handleUnstar } from '@/lib/subsonic-favorites'
import { handleCoverArtAsync, handleGetLyricsAsync, handleGetLyricsBySongIdAsync, handleGetAlbumAsync } from '@/lib/subsonic-metadata'
import { handleGetSongAsync } from '@/lib/subsonic-song'
import { handleGetRandomSongs } from '@/lib/subsonic-random'
import { handleGetStarred, handleGetStarred2 } from '@/lib/subsonic-getstarred'
import { handleGetPlaylists, handleGetPlaylist, handleCreatePlaylist, handleDeletePlaylist, handleUpdatePlaylist } from '@/lib/subsonic-playlist'
import { respond, subsonicError } from '@/lib/subsonic'
import { handleGetOpenSubsonicExtensions, handleGetUser, handleGetAlbumList2, handleScrobble, handleGetSimilarSongs } from '@/lib/subsonic-system'
import { handleStream } from '@/lib/subsonic-stream'
import auth, { type AuthResult } from '@/lib/auth'
import configSync from '@/lib/config-sync'
import { logger } from '@/lib/logger'

// 同步启动配置中的用户（非阻塞）
configSync.syncUsersFromConfig().then(r => console.info('[startup] config-sync result', r)).catch(e => console.warn('[startup] config-sync error', e))

function normalizeMethod(raw: string | undefined) {
  if (!raw) return ''
  return raw.replace(/\.view$/i, '')
}

/**
 * 认证开关（REQUIRE_AUTH 环境变量）：
 * - 未设置 → 全部方法（除 AUTH_EXEMPT_METHODS）要求 Subsonic token 认证
 * - false | off | none → 关闭强制认证（仅 WRITE_METHODS 仍要求 token）
 * - 其它非空值 → 方法名列表，仅列表内方法要求认证（向后兼容精细控制）
 */
function isMethodAuthRequired(method: string): boolean {
  const raw = (process.env.REQUIRE_AUTH ?? '').trim().toLowerCase()
  if (raw === 'false' || raw === 'off' || raw === 'none') return false
  if (raw === '') return true
  return parseListParam(process.env.REQUIRE_AUTH ?? null).includes(method)
}

/** 无用户数据、始终匿名可用的方法 */
const AUTH_EXEMPT_METHODS = new Set(['ping', 'getOpenSubsonicExtensions', 'getScanStatus'])

/**
 * 如果认证失败（token 无效），返回认证失败响应。
 * 注意：auth_required（强制认证开启但未带 token）不在此拦截——
 * 由下方豁免集之后的强制认证检查统一处理，保证豁免方法即使带 u 参数也能匿名访问。
 */
function checkAuthError(request: NextRequest, authRes: AuthResult): Response | null {
  if (authRes.error === 'invalid_t') {
    return auth.authFailedResponse(request, 'invalid_t')
  }
  return null
}

/**
 * 写操作方法集合：必须通过 Subsonic token 认证（u+t+s，authRes.verified）才能调用。
 * 读操作（search3 / stream / getSong / getStarred / getPlaylists 等）保持匿名可用。
 *
 * 注意：resolveUserFromParams 在仅传 u=<用户名> 不带 token 时也会建用户并填充
 * authRes.user（verified=false）。若只校验 authRes.user，则任何人传 u=admin 即可以
 * admin 身份写——因此这里必须校验 verified，才是有效门禁。
 */
const WRITE_METHODS = new Set([
  'star', 'unstar',
  'createPlaylist', 'deletePlaylist', 'updatePlaylist',
])

function checkWriteAuth(request: NextRequest, method: string, authRes: AuthResult): Response | null {
  if (WRITE_METHODS.has(method) && !authRes.verified) {
    return auth.authFailedResponse(request, 'Authentication required')
  }
  return null
}

async function handleMethod(request: NextRequest, method: string) {
  // 统一入口：进行一次性认证
  const authRes = await auth.resolveUserFromRequest(request)

  // 检查认证错误（token 无效）
  const authError = checkAuthError(request, authRes)
  if (authError) return authError

  // 写操作必须通过 token 认证（u+t+s），阻断"仅传用户名冒名写"
  const writeAuthError = checkWriteAuth(request, method, authRes)
  if (writeAuthError) return writeAuthError

  // 强制认证：默认所有方法（除豁免集）要求已认证用户；
  // REQUIRE_AUTH 为方法列表时仅列表内方法要求（向后兼容）
  if (isMethodAuthRequired(method) && !AUTH_EXEMPT_METHODS.has(method) && !authRes.verified) {
    return auth.authFailedResponse(request, 'Authentication required')
  }

  // 分发到各个 handler，传递 authRes 避免重复查询
  switch (method) {
    case 'ping':
      return handlePing(request)
    case 'search3':
      return handleSearch(request, authRes)
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
    case 'getLyricsBySongId':
      // OpenSubsonic 结构化歌词（Musiver 优先调用）
      return handleGetLyricsBySongIdAsync(request, authRes)
    case 'getSong':
      // 使用异步版本获取歌曲信息（从数据库直接查询）
      return handleGetSongAsync(request, authRes)
    case 'getAlbum':
      // 专辑详情（含歌曲列表），id 为 source-{songmid}
      return handleGetAlbumAsync(request, authRes)
    case 'getStarred':
      return handleGetStarred(request, authRes)
    case 'getStarred2':
      return handleGetStarred2(request, authRes)
    case 'getPlaylists':
      return handleGetPlaylists(request, authRes)
    case 'getPlaylist':
      return handleGetPlaylist(request, authRes)
    case 'createPlaylist':
      return handleCreatePlaylist(request, authRes)
    case 'deletePlaylist':
      return handleDeletePlaylist(request, authRes)
    case 'getOpenSubsonicExtensions':
      return handleGetOpenSubsonicExtensions(request, authRes)
    case 'getUser':
      return handleGetUser(request, authRes)
    case 'getAlbumList2':
      return handleGetAlbumList2(request, authRes)
    case 'getScanStatus':
      return respond(request, { scanStatus: { scanning: false, count: 10000 } })
    case 'scrobble':
      // 听歌统计暂不落库，返回 ok
      return handleScrobble(request, authRes)
    case 'getSimilarSongs':
    case 'getSimilarSongs2':
      // 相似歌曲暂不实现，返回空列表
      return handleGetSimilarSongs(request, authRes)
    case 'getRandomSongs':
      // 随机歌曲（从 DB 已入库曲目中随机抽取）
      return handleGetRandomSongs(request)
    // case 'getAlbumList':
    //   const getAlbumList = '<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1"><albumList2><album id="412776666696599617" coverArt="al-412776666696599617" songCount="0" duration="2025" year="2025" name="安和桥北" created="2025-11-27T16:16:23"/><album id="412759344724095257" coverArt="al-412759344724095257" songCount="0" duration="2025" year="2025" name="十一月的萧邦" created="2025-11-27T15:07:33"/></albumList2></subsonic-response>';
    //       return new Response(getAlbumList, {
    //   status: 200,
    //   headers: {
    //     'Content-Type': 'application/xml; charset=utf-8',
    //     'Content-Length': String(Buffer.byteLength(getAlbumList, 'utf8'))
    //   }})
    case 'updatePlaylist':
      return handleUpdatePlaylist(request, authRes)
    default: {
      // 返回 subsonic 风格的 404/未找到响应
      logger.warn('[rest] Method not found:', method)
      return subsonicError(request, 70, `Method not found: ${method}`)
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
  logger.debug('[rest] params:', params, 'raw:', raw, 'method:', method, 'requestUrl:', request.url)

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
