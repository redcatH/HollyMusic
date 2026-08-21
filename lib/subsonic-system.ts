import { NextRequest } from 'next/server'
import { respond, subsonicError, TEXT_KEY, type SubsonicPayload } from './subsonic'
import { type AuthResult } from './auth'
import { PrismaClient } from './generated/prisma'
import { logger } from './logger'

const prisma = new PrismaClient()

/**
 * 返回支持的 OpenSubsonic 扩展列表（静态/可配置）
 */
export async function handleGetOpenSubsonicExtensions(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    // OpenSubsonic 规范格式：单个 openSubsonicExtensions 容器 + extension 子元素，
    // versions 为该扩展支持的版本号列表。可按需改为从配置读取或根据功能开关动态构建
    return respond(request, {
      openSubsonicExtensions: {
        extension: [
          { name: 'songLyrics', versions: '1 2' },
          { name: 'formPost', versions: '1 2' },
        ],
      },
    })
  } catch (err) {
    logger.error('[getOpenSubsonicExtensions] Error:', err)
    return subsonicError(request, 0, 'Internal server error')
  }
}

/**
 * 返回用户信息（强制使用认证结果，不接受 query 参数指定他人身份，防越权）
 *
 * 注意：根据项目的 Prisma `User` 模型字段命名，部分字段（如 email、isAdmin、nickName）
 * 可能需调整。函数会尽量使用可用字段并提供安全的默认值。
 */
export async function handleGetUser(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    // 认证开启时 authRes.user 必有值（route 层已拦截未认证请求）
    const user = authRes.user

    if (!user) {
      return subsonicError(request, 10, 'Missing required parameter: username')
    }

    // 构建用户的响应节点。字段名称依赖于你的 Prisma `User` 模型；这里使用了可用字段并提供回退值。
    const username = user.username || ''
    const email = (user as any).email || ''
    const adminRole = Boolean((user as any).isAdmin || (user as any).admin)
    const nickName = (user as any).nickName || (user as any).nick || ''

    return respond(request, {
      user: {
        username,
        email,
        adminRole,
        folder: {}, // 空元素 <folder/>
        forcePasswordChange: { [TEXT_KEY]: 'false' }, // 标量子元素
        nickName: { [TEXT_KEY]: nickName },
      },
    })
  } catch (err) {
    logger.error('[getUser] Error:', err)
    return subsonicError(request, 0, 'Internal server error')
  }
}

/**
 * 处理 getAlbumList2 请求 - 返回按专辑分组的专辑列表，参数说明如下：
 *
 * 请求地址: GET /rest/getAlbumList2
 * 最低客户端版本: 1.8.0
 *
 * 参数表：
 * - type (必填): 排序/筛选方式，支持的取值及含义：
 *     - random：随机排序，返回随机的专辑列表。
 *     - newest：按时间排序，最新的专辑排在前面（按专辑下最新曲目的创建时间或代表时间）。
 *     - frequent：按播放频次排序，最常被播放的专辑排在前面（基于 `PlayHistory` 统计，可能较慢）。
 *     - recent：与 newest 类似，返回最近更新/新增的专辑。
 *     - starred：返回当前用户已收藏（star）的专辑，需认证（user 必须存在）。
 *     - alphabeticalByName：按专辑名字母顺序排序（A..Z）。
 *     - alphabeticalByArtist：按艺术家/歌手名字母顺序排序。
 *     - byYear：按年代筛选，需同时提供 `fromYear` 和 `toYear` 参数；当 fromYear > toYear 时结果会倒序返回。
 *     - byGenre：按流派筛选，需提供 `genre` 参数。注意：当前 `MusicInfo` 模型没有明确的 genre 字段，
 *                如需生效请告诉我数据在哪个字段（例如 `typesJson` 或 `typesMapJson`），我会解析并过滤。
 *
 * - size (可选，默认 10，最大 500): 返回结果数量，用于分页大小。
 * - offset (可选，默认 0): 偏移数量，用于分页起点。
 * - fromYear (必填 when type=byYear): 年代下限（整数）。
 * - toYear (必填 when type=byYear): 年代上限（整数）。
 * - genre (必填 when type=byGenre): 流派名称或关键字。
 * - musicFolderId (可选): 音乐目录 ID（当前实现未映射到数据库字段，作为占位参数；如果你有目录映射字段，我可以加入过滤）。
 *
 * 返回：Subsonic `albumList2` 格式的 XML 节点，示例节点为 `<album id="..." coverArt="..." songCount="..." duration="..." name="..." created="..."/>`。
 *
 * 备注：
 * - 如果数据库缺少明确的年份或流派字段，函数会做 best-effort 的回退（例如从 `createdAt` 推断年份）。
 * - `frequent` 类型会根据 `PlayHistory` 聚合统计，可能需要优化索引或预计算以提高性能。
 */
export async function handleGetAlbumList2(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const url = new URL(request.url)

    // Parameters
    const type = url.searchParams.get('type')
    if (!type) {
      return subsonicError(request, 10, 'Missing required parameter: type')
    }

    const sizeRaw = parseInt(url.searchParams.get('size') || '10', 10) || 10
    const size = Math.min(500, Math.max(0, sizeRaw))
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
    const fromYear = url.searchParams.get('fromYear')
    const toYear = url.searchParams.get('toYear')
    const genre = url.searchParams.get('genre')
    const musicFolderId = url.searchParams.get('musicFolderId')

    // Validate parameters for specific types
    if (type === 'byYear') {
      if (!fromYear || !toYear) {
        return subsonicError(request, 10, 'Missing required parameters: fromYear/toYear for type=byYear')
      }
    }
    if (type === 'byGenre') {
      if (!genre) {
        return subsonicError(request, 10, 'Missing required parameter: genre for type=byGenre')
      }
    }

    // Basic grouping by albumId/albumName
    const groups = await prisma.musicInfo.groupBy({
      by: ['albumId', 'albumName'],
      where: { albumId: { not: null } },
      _count: { _all: true },
      _sum: { durationSeconds: true }
    })

    const albumIds = groups.map(g => g.albumId).filter((v): v is string => !!v)

    // Representative rows for metadata（id asc 第一首作代表曲，与 getFirstMusicInfoByAlbumId 一致）
    const reps = await prisma.musicInfo.findMany({ where: { albumId: { in: albumIds } }, orderBy: { id: 'asc' } })
    const repMap: Record<string, { source?: string | null; songmid?: string | null; createdAt?: Date | null; singer?: string | null }> = {}
    for (const r of reps) {
      if (!repMap[r.albumId || '']) repMap[r.albumId || ''] = { source: r.source, songmid: r.songmid, createdAt: r.createdAt, singer: r.singer }
    }

    // Build album objects（id/coverArt 统一用代表曲的 source-{songmid}）
    let albums = groups.map(g => {
      const rep = repMap[g.albumId || '']
      const albumEntryId = rep && rep.source && rep.songmid ? `${rep.source}-${rep.songmid}` : ''
      return {
        id: albumEntryId,
        name: g.albumName || '',
        songCount: g._count._all || 0,
        duration: g._sum.durationSeconds ?? 0,
        created: rep?.createdAt,
        coverArt: albumEntryId,
        artist: rep?.singer || ''
      }
    })

    // Apply filters for byYear and byGenre if data available (best-effort; MusicInfo has no explicit year/genre fields)
    if (type === 'byYear') {
      // Attempt to derive year from created date as fallback
      const fy = parseInt(fromYear || '', 10)
      const ty = parseInt(toYear || '', 10)
      if (isNaN(fy) || isNaN(ty)) {
        return subsonicError(request, 10, 'Invalid fromYear/toYear')
      }
      albums = albums.filter(a => {
        const y = a.created ? a.created.getFullYear() : NaN
        return !isNaN(y) && y >= Math.min(fy, ty) && y <= Math.max(fy, ty)
      })
      // If fromYear > toYear, reverse order
      if (parseInt(fromYear || '0', 10) > parseInt(toYear || '0', 10)) albums.reverse()
    }

    if (type === 'byGenre') {
      // No genre field in MusicInfo; return empty list (could be extended)
      albums = []
    }

    // Ordering by type
    switch (type) {
      case 'random': {
        // shuffle albums
        for (let i = albums.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[albums[i], albums[j]] = [albums[j], albums[i]]
        }
        break
      }
      case 'newest':
      case 'recent':
        albums.sort((a, b) => (b.created ? b.created.getTime() : 0) - (a.created ? a.created.getTime() : 0))
        break
      case 'alphabeticalByName':
        albums.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        break
      case 'alphabeticalByArtist':
        albums.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''))
        break
      case 'frequent': {
        // Use PlayHistory to rank frequent albums by play count
        const hits = await prisma.playHistory.groupBy({ by: ['musicInfoId'], _count: { _all: true }, where: { musicInfoId: { not: null } } })
        const countsByAlbum: Record<string, number> = {}
        for (const h of hits) {
          const mi = await prisma.musicInfo.findUnique({ where: { id: h.musicInfoId as number } })
          if (mi && mi.albumId) countsByAlbum[mi.albumId] = (countsByAlbum[mi.albumId] || 0) + (h._count._all || 0)
        }
        albums.sort((a, b) => (countsByAlbum[b.id] || 0) - (countsByAlbum[a.id] || 0))
        break
      }
      case 'starred': {
        // Starred albums for authenticated user
        const username = authRes.user?.username
        if (!username) {
          return subsonicError(request, 40, 'Authentication required for starred')
        }
        const u = await prisma.user.findUnique({ where: { username } })
        if (!u) {
          return subsonicError(request, 70, 'User not found')
        }
        const favs = await prisma.favorite.findMany({ where: { userId: u.id, itemType: 'album' } })
        const favSet = new Set(favs.map(f => f.itemId))
        albums = albums.filter(a => favSet.has(a.id))
        break
      }
      default:
        // other types handled above
        break
    }

    const slice = albums.slice(offset, offset + size)
    const albumNodes: SubsonicPayload[] = slice.map(a => {
      const createdStr = a.created ? new Date(a.created).toISOString().replace('T', ' ').substring(0, 19) : new Date().toISOString().replace('T', ' ').substring(0, 19)
      return {
        id: a.id,
        coverArt: a.coverArt || a.id,
        songCount: a.songCount,
        duration: a.duration,
        name: a.name,
        created: createdStr,
      }
    })

    return respond(request, { albumList2: { album: albumNodes } })
  } catch (err) {
    logger.error('[getAlbumList2] Error:', err)
    return subsonicError(request, 0, 'Internal server error')
  }
}

/**
 * 处理 scrobble 请求 — 听歌统计暂不落库，返回 ok 避免 Musiver 报错。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleScrobble(request: NextRequest, authRes: AuthResult): Promise<Response> {
  return respond(request, null)
}

/**
 * 处理 getSimilarSongs 请求 — 相似歌曲暂不实现，返回空列表。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleGetSimilarSongs(request: NextRequest, authRes: AuthResult): Promise<Response> {
  return respond(request, { similarSongs: {} })
}
