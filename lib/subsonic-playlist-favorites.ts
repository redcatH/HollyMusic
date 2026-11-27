import type { NextRequest } from 'next/server'
import type { AuthResult } from './auth'
import { PrismaClient, type FavoritePlaylist } from './generated/prisma'
import { logger } from './logger'
import { respond, subsonicError, type SubsonicPlaylistNode, type SubsonicSongNode } from './subsonic'
import { resolveSubsonicMediaMeta } from './subsonic-media'
import { getRecommendedPlaylistDetail, isDiscoverySource, type DiscoveryCollectionDetail } from './services/discovery-service'
import { getFavoritePlaylistById, listFavoritePlaylistRecords, removeFavoritePlaylistById } from './services/favorite-playlist-service'
import { parseIntervalToSeconds } from './types/player'
import { PLATFORM_NAMES } from './platform-plugins'

const prisma = new PrismaClient()
const SOURCE_NAMES: Record<string, string> = { ...PLATFORM_NAMES, tx: 'QQ音乐' }

/** 收藏记录与本地歌单使用独立 ID 空间，原平台 ID 不进入协议解析。 */
export function isFavoritePlaylistId(id: string): boolean {
  return id.startsWith('fp-')
}

function parseFavoritePlaylistId(id: string): number | null {
  if (!/^fp-[1-9]\d*$/.test(id)) return null
  const value = Number(id.slice(3))
  return Number.isSafeInteger(value) ? value : null
}

export async function getSubsonicFavoritePlaylist(id: string, authRes: AuthResult): Promise<FavoritePlaylist | null> {
  // 即使服务器允许匿名读取，也不能通过 u=用户名读取该用户的私人收藏。
  if (!authRes.verified || !authRes.user) return null
  const recordId = parseFavoritePlaylistId(id)
  return recordId === null ? null : getFavoritePlaylistById(authRes.user.id, recordId)
}

function toPlaylistNode(playlist: FavoritePlaylist, username: string): SubsonicPlaylistNode {
  const source = SOURCE_NAMES[playlist.source] ?? playlist.source
  const id = `fp-${playlist.id}`
  return {
    id,
    name: `【${source}】${playlist.name}`,
    comment: `平台收藏 · 内容只读 · 删除仅取消收藏${playlist.author ? ` · 作者：${playlist.author}` : ''}`,
    owner: username,
    public: false,
    songCount: playlist.songCount,
    duration: 0,
    created: playlist.createdAt.toISOString(),
    coverArt: `pl-${id}`,
  }
}

export async function listSubsonicFavoritePlaylists(authRes: AuthResult): Promise<SubsonicPlaylistNode[]> {
  if (!authRes.verified || !authRes.user) return []
  const user = authRes.user
  const playlists = await listFavoritePlaylistRecords(user.id)
  // 列表只读收藏快照，不为每个歌单请求上游，避免平台故障拖垮整个列表。
  return playlists.map(playlist => toPlaylistNode(playlist, user.username))
}

export async function loadFavoritePlaylistDetail(playlist: FavoritePlaylist): Promise<DiscoveryCollectionDetail | null> {
  if (!isDiscoverySource(playlist.source)) return null
  // 复用发现页的缓存、分页与 checksum 入库流程，uid 可直接用于播放/歌词/封面。
  return getRecommendedPlaylistDetail(playlist.source, playlist.playlistId)
}

export async function handleGetFavoritePlaylist(request: NextRequest, authRes: AuthResult, id: string): Promise<Response> {
  if (!authRes.verified || !authRes.user) return subsonicError(request, 40, 'Authentication required')
  const playlist = await getSubsonicFavoritePlaylist(id, authRes)
  if (!playlist) return subsonicError(request, 70, 'Playlist not found')

  let detail: DiscoveryCollectionDetail | null
  try {
    detail = await loadFavoritePlaylistDetail(playlist)
  } catch (err) {
    logger.warn('[getPlaylist] Failed to load platform favorite:', err)
    return subsonicError(request, 0, 'Platform playlist temporarily unavailable; favorite retained')
  }
  if (!detail) return subsonicError(request, 70, 'Platform playlist unavailable; favorite retained')

  const favorites = detail.tracks.length > 0 ? await prisma.favorite.findMany({
    where: { userId: authRes.user.id, itemType: 'song', itemId: { in: detail.tracks.map(track => track.uid) } },
    select: { itemId: true, createdAt: true },
  }) : []
  const starredById = new Map(favorites.map(favorite => [favorite.itemId, favorite.createdAt]))
  const entries: SubsonicSongNode[] = detail.tracks.map(track => {
    const meta = resolveSubsonicMediaMeta(track)
    return {
      id: track.uid,
      parent: id,
      title: track.name,
      album: track.albumName || '',
      artist: track.singer,
      isDir: false,
      coverArt: track.uid,
      albumId: track.uid,
      duration: parseIntervalToSeconds(track.interval),
      bitRate: meta.bitRate,
      size: meta.size,
      suffix: meta.suffix,
      contentType: meta.contentType,
      isVideo: false,
      type: 'music',
      path: `${track.singer || 'Unknown'}/${track.albumName || 'Unknown'}/${track.name || 'Unknown'}${meta.suffix ? `.${meta.suffix}` : ''}`,
      starred: starredById.get(track.uid)?.toISOString().substring(0, 19),
    }
  })

  return respond(request, {
    playlist: {
      ...toPlaylistNode({ ...playlist, name: detail.name, author: detail.author }, authRes.user.username),
      songCount: entries.length,
      duration: entries.reduce((total, entry) => total + (entry.duration || 0), 0),
      entry: entries,
    },
  }, { rootAttrs: { type: 'navidrome' }, headers: { 'Cache-Control': 'no-store' } })
}

export function rejectFavoritePlaylistEdit(request: NextRequest, authRes: AuthResult): Response {
  if (!authRes.verified || !authRes.user) return subsonicError(request, 40, 'Authentication required')
  return subsonicError(request, 50, 'Platform favorites are read-only; copy songs to a local playlist to edit')
}

export async function handleDeleteFavoritePlaylist(request: NextRequest, authRes: AuthResult, id: string): Promise<Response> {
  if (!authRes.verified || !authRes.user) return subsonicError(request, 40, 'Authentication required')
  const recordId = parseFavoritePlaylistId(id)
  if (recordId === null || !await removeFavoritePlaylistById(authRes.user.id, recordId)) {
    return subsonicError(request, 70, 'Playlist not found')
  }
  return respond(request, null)
}
