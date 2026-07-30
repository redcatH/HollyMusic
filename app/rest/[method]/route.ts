import { NextRequest } from 'next/server'
import { handlePing } from '@/lib/subsonic-ping'
import { handleSearch } from '@/lib/subsonic-search'
import { handleStar, handleUnstar } from '@/lib/subsonic-favorites'
import { handleCoverArtAsync, handleGetLyricsAsync, handleGetLyricsBySongIdAsync, handleGetAlbumAsync } from '@/lib/subsonic-metadata'
import { handleGetSongAsync } from '@/lib/subsonic-song'
import { handleGetRandomSongs } from '@/lib/subsonic-random'
import { handleGetStarred } from '@/lib/subsonic-getstarred'
import { handleGetPlaylists, handleGetPlaylist, handleCreatePlaylist, handleDeletePlaylist, handleUpdatePlaylist } from '@/lib/subsonic-playlist'
import { formatSubsonicXML, createSubsonicResponse } from '@/lib/subsonic'
import { handleGetOpenSubsonicExtensions, handleGetUser, handleGetAlbumList2, handleScrobble, handleGetSimilarSongs } from '@/lib/subsonic-system'
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
    case 'getPlaylists':
      return handleGetPlaylists(request, authRes)
    case 'getPlaylist':
      return handleGetPlaylist(request, authRes)
      const children = `
<playlist id="2" name="dj" comment="" owner="admin" public="false" songCount="2" duration="0" created="2025-12-02 05:54:13" coverArt="pl-2">
<allowedUser>admin</allowedUser>
<entry id="" parent="" title="" album="" artist="" isDir="false" coverArt="" created="2025-12-02T05:54:19.179Z" duration="undefined" bitRate="320" track="0" year="" genre="" size="undefined" suffix="" contentType="" isVideo="false" path="" albumId="" artistId="" type="music"/>
<entry id="338638" parent="1737790" title="夜曲" album="第六届全球华语歌曲排行榜颁奖典礼" artist="周杰伦" isDir="false" coverArt="pl-2" created="2025-12-02T07:05:31.716Z" duration="0" bitRate="320" track="0" year="" genre="" size="0" suffix="mp3" contentType="audio/mpeg" isVideo="false" path="周杰伦/第六届全球华语歌曲排行榜颁奖典礼/夜曲.mp3" albumId="1737790" artistId="" type="music"/>
</playlist>`;
      const xml = formatSubsonicXML({ status: 'ok', children })
      return createSubsonicResponse(xml)
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
       const getScanStatus = formatSubsonicXML({
        status: 'ok',
        children:'<scanStatus scanning="false" count="10000"/>' }
      )
      return createSubsonicResponse(getScanStatus)
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
