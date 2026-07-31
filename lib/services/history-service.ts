/**
 * 播放历史 service
 *
 * 使用 Prisma PlayHistory 表（schema 已存在，无需 migration）。
 * 上报时先 upsertMusicInfo 确保歌曲入库，再写历史记录，保证 musicInfoId 可关联。
 */

import { PrismaClient } from '../generated/prisma'
import * as dbAPI from '../db'
import { getStorageSongmidForMusicInfo } from '../db'
import { logger } from '../logger'
import type { MusicInfo } from '../types/music'

const prisma = new PrismaClient()

export interface HistoryEntry {
  id: number
  songId: string | null
  musicInfo: MusicInfo | null
  playedAt: string
}

/**
 * 上报一次播放。确保歌曲入库后写入 PlayHistory。
 */
export async function reportPlay(username: string, musicInfo: MusicInfo): Promise<void> {
  // 1) 确保歌曲入库（带 checksum 去重）
  await dbAPI.upsertMusicInfo(musicInfo)

  const storageSongmid = getStorageSongmidForMusicInfo(musicInfo)
  const songId = `${musicInfo.source}-${storageSongmid}`

  // 2) 查 MusicInfo 行 id（用于关联）
  const row = await prisma.musicInfo.findUnique({
    where: { source_songmid: { source: musicInfo.source, songmid: storageSongmid } },
    select: { id: true },
  })

  // 3) 写历史
  await prisma.playHistory.create({
    data: {
      username,
      musicInfoId: row?.id ?? null,
      songmid: songId,
    },
  })
  logger.debug(`[history] reported play: ${songId} for ${username}`)
}

/**
 * 查询播放历史（按时间倒序），逐条富化 MusicInfo。
 */
export async function listHistory(
  username: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ list: HistoryEntry[]; total: number }> {
  const limit = opts?.limit ?? 100
  const offset = opts?.offset ?? 0

  const rows = await prisma.playHistory.findMany({
    where: { username },
    orderBy: { playedAt: 'desc' },
    take: limit,
    skip: offset,
  })
  const total = await prisma.playHistory.count({ where: { username } })

  const list: HistoryEntry[] = []
  for (const row of rows) {
    const musicInfo = row.songmid ? await dbAPI.resolveMusicInfoById(row.songmid) : null
    list.push({
      id: row.id,
      songId: row.songmid,
      musicInfo,
      playedAt: row.playedAt.toISOString(),
    })
  }

  return { list, total }
}

/**
 * 清空用户的播放历史。
 */
export async function clearHistory(username: string): Promise<{ deleted: number }> {
  const res = await prisma.playHistory.deleteMany({ where: { username } })
  logger.info(`[history] cleared ${res.count} entries for ${username}`)
  return { deleted: res.count }
}
