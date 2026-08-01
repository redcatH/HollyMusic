/**
 * 播放历史 service
 *
 * 使用 Prisma PlayHistory 表。
 * 上报时先 upsertMusicInfo 确保歌曲入库，再写历史记录，保证 musicInfoId 可关联。
 *
 * 去重策略（商业项目主流做法）：
 *   同一用户同一首歌只保留一条记录（@@unique([username, songmid])）。
 *   再次播放时 upsert 更新 playedAt 为当前时间，自然"移动到顶部"，
 *   避免历史列表出现重复项，也修复了 SongRow 多行同时高亮的问题。
 *
 * 上限策略：
 *   每用户最多 MAX_HISTORY_PER_USER 条（默认 500），超过则删除最旧的记录，
 *   保证数据库行数可控、查询性能稳定。
 */

import { PrismaClient } from '../generated/prisma'
import * as dbAPI from '../db'
import { getStorageSongmidForMusicInfo } from '../db'
import { logger } from '../logger'
import type { MusicInfo } from '../types/music'

const prisma = new PrismaClient()

/** 每用户历史记录上限，超出则 FIFO 淘汰最旧记录。可通过环境变量覆盖。 */
const MAX_HISTORY_PER_USER = Number(process.env.MAX_HISTORY_PER_USER) || 500

export interface HistoryEntry {
  id: number
  songId: string | null
  musicInfo: MusicInfo | null
  playedAt: string
}

/**
 * 上报一次播放。
 *
 * 1. 确保歌曲入库（带 checksum 去重）
 * 2. upsert 历史记录：已存在则更新 playedAt（移动到顶部），不存在则新建
 * 3. 超过上限时删除该用户最旧的记录
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

  // 3) upsert 历史：已存在则更新 playedAt（移动到顶部），不存在则新建
  await prisma.playHistory.upsert({
    where: { username_songmid: { username, songmid: songId } },
    create: {
      username,
      musicInfoId: row?.id ?? null,
      songmid: songId,
    },
    update: {
      playedAt: new Date(),
      musicInfoId: row?.id ?? null,
    },
  })
  logger.debug(`[history] reported play: ${songId} for ${username}`)

  // 4) 上限裁剪：超过 MAX_HISTORY_PER_USER 则删除最旧的记录
  await trimHistory(username)
}

/**
 * 删除该用户超出上限的最旧历史记录。
 * 取最旧的 (count - MAX) 条，按 playedAt 升序删除。
 */
async function trimHistory(username: string): Promise<void> {
  const count = await prisma.playHistory.count({ where: { username } })
  if (count <= MAX_HISTORY_PER_USER) return

  const overflow = count - MAX_HISTORY_PER_USER
  const oldest = await prisma.playHistory.findMany({
    where: { username },
    orderBy: { playedAt: 'asc' },
    take: overflow,
    select: { id: true },
  })
  if (oldest.length === 0) return

  await prisma.playHistory.deleteMany({
    where: { id: { in: oldest.map(r => r.id) } },
  })
  logger.info(`[history] trimmed ${oldest.length} oldest entries for ${username}`)
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
