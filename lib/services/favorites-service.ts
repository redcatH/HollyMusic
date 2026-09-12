/**
 * 收藏 service
 *
 * 复用 lib/favorites.ts 的数据层（starItems/unstarItems/listFavorites），
 * 在其之上做 song id 解析与 MusicInfo 富化，返回原始数据（非 XML）。
 *
 * song id 统一为 source-{存储songmid}，与 db.resolveMusicInfoById 的解析口径一致。
 */

import { PrismaClient } from '../generated/prisma'
import { starItems, unstarItems, listFavorites } from '../favorites'
import { getStorageSongmidForMusicInfo } from '../db'
import { logger } from '../logger'
import type { MusicInfo } from '../types/music'

const prisma = new PrismaClient()

export interface FavoriteSong {
  songId: string
  source: string | null
  starredAt: string
  musicInfo: MusicInfo | null
}

/**
 * 解析 song id（source-songmid）中的 source 平台。
 */
function parseSourceFromSongId(songId: string): string | null {
  if (!songId || !songId.includes('-')) return null
  const idx = songId.indexOf('-')
  const src = songId.substring(0, idx)
  return src || null
}

/**
 * 批量解析 source-songmid → MusicInfo（N+1 优化）。
 * 解析口径与 db.resolveMusicInfoById 一致（第一个 '-' 前为 source，后为存储 songmid），
 * 按源分组各发一次 findMany，代替逐条 findUnique。
 * 返回 Map 的 key 为 `${source}-{存储songmid}`，与传入 id 同格式。
 */
async function resolveMusicInfoBatch(ids: string[]): Promise<Map<string, MusicInfo>> {
  const result = new Map<string, MusicInfo>()
  const groups = new Map<string, Set<string>>()
  for (const id of ids) {
    if (!id.includes('-')) continue
    const idx = id.indexOf('-')
    const src = id.substring(0, idx)
    const mid = id.substring(idx + 1)
    if (!src || !mid) continue
    const songmids = groups.get(src) ?? new Set<string>()
    songmids.add(mid)
    groups.set(src, songmids)
  }
  if (groups.size === 0) return result

  const rows = await prisma.musicInfo.findMany({
    where: {
      OR: [...groups.entries()].map(([source, songmids]) => ({
        source,
        songmid: { in: [...songmids] },
      })),
    },
    select: { source: true, songmid: true, data: true },
  })
  for (const row of rows) {
    if (!row.data) continue
    try {
      const mi = JSON.parse(row.data) as MusicInfo
      result.set(`${row.source}-${row.songmid}`, mi)
    } catch {
      // 跳过解析失败的行，保持与逐条解析一致的容错语义
    }
  }
  return result
}

/**
 * 收藏一首歌。
 */
export async function starSong(userId: number, songId: string): Promise<{ starred: true }> {
  const source = parseSourceFromSongId(songId)
  await starItems(userId, [{ itemType: 'song', itemId: songId, source }])
  logger.info(`[favorites] starred ${songId} for user ${userId}`)
  return { starred: true }
}

/**
 * 取消收藏一首歌。
 */
export async function unstarSong(userId: number, songId: string): Promise<{ starred: false }> {
  await unstarItems(userId, [{ itemType: 'song', itemId: songId }])
  logger.info(`[favorites] unstarred ${songId} for user ${userId}`)
  return { starred: false }
}

/**
 * 获取收藏列表（按收藏时间倒序），批量富化 MusicInfo。
 */
export async function listFavoriteSongs(
  userId: number,
  opts?: { limit?: number; offset?: number }
): Promise<{ list: FavoriteSong[]; total: number }> {
  const limit = opts?.limit ?? 200
  const offset = opts?.offset ?? 0

  const rows = await listFavorites(userId, { itemType: 'song', limit, offset })
  const total = await prisma.favorite.count({ where: { userId, itemType: 'song' } })

  const musicInfoById = await resolveMusicInfoBatch(rows.map(r => r.itemId))

  const list: FavoriteSong[] = rows.map(row => {
    const musicInfo = musicInfoById.get(row.itemId) ?? null
    // 用 musicInfo 重算 songId，保证与搜索/随机等出口一致
    const songId = musicInfo
      ? `${musicInfo.source}-${getStorageSongmidForMusicInfo(musicInfo)}`
      : row.itemId
    return {
      songId,
      source: row.source,
      starredAt: row.createdAt.toISOString(),
      musicInfo,
    }
  })

  return { list, total }
}
