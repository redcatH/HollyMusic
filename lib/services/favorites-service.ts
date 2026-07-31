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
import * as dbAPI from '../db'
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
 * 检查是否已收藏。
 */
export async function checkStarred(userId: number, songId: string): Promise<boolean> {
  const row = await prisma.favorite.findFirst({
    where: { userId, itemType: 'song', itemId: songId },
    select: { id: true },
  })
  return !!row
}

/**
 * 获取收藏列表（按收藏时间倒序），逐条富化 MusicInfo。
 */
export async function listFavoriteSongs(
  userId: number,
  opts?: { limit?: number; offset?: number }
): Promise<{ list: FavoriteSong[]; total: number }> {
  const limit = opts?.limit ?? 200
  const offset = opts?.offset ?? 0

  const rows = await listFavorites(userId, { itemType: 'song', limit, offset })
  const total = await prisma.favorite.count({ where: { userId, itemType: 'song' } })

  const list: FavoriteSong[] = []
  for (const row of rows) {
    const musicInfo = await dbAPI.resolveMusicInfoById(row.itemId)
    // 用 musicInfo 重算 songId，保证与搜索/随机等出口一致
    const songId = musicInfo
      ? `${musicInfo.source}-${getStorageSongmidForMusicInfo(musicInfo)}`
      : row.itemId
    list.push({
      songId,
      source: row.source,
      starredAt: row.createdAt.toISOString(),
      musicInfo,
    })
  }

  return { list, total }
}
