/**
 * 歌单 service
 *
 * 直接操作 Prisma（参考 lib/subsonic-playlist.ts 的查询逻辑），返回原始数据（非 XML）。
 * 权限模型与 subsonic 一致：自己创建的 + 公开的 + 被授权的可访问；写操作仅 owner。
 */

import { PrismaClient, Prisma } from '../generated/prisma'
import { logger } from '../logger'
import type { MusicInfo } from '../types/music'

const prisma = new PrismaClient()

export interface PlaylistSummary {
  id: number
  name: string
  comment: string | null
  owner: string | null
  username: string
  isPublic: boolean
  songCount: number
  duration: number | null
  /** 用户自定义封面；当前未提供上传入口，预留给后续封面管理功能。 */
  coverArt: string | null
  /** 未设置自定义封面时，用于展示歌单第一首歌的封面。 */
  coverSongUid: string | null
  createdAt: string
}

export interface PlaylistEntryItem {
  position: number
  songId: string
  musicInfo: MusicInfo | null
  addedAt: string
  addedBy: string | null
}

export interface PlaylistDetail extends PlaylistSummary {
  entries: PlaylistEntryItem[]
  allowedUsers: string[]
}

export interface PlaylistCoverData {
  coverArt: string | null
  songId: string | null
  musicInfo: MusicInfo | null
}

function toSummary(p: Prisma.PlaylistGetPayload<{ include: { allowedUsers: true } }>): PlaylistSummary {
  return {
    id: p.id,
    name: p.name,
    comment: p.comment,
    owner: p.owner,
    username: p.username,
    isPublic: p.isPublic,
    songCount: p.songCount,
    duration: p.duration,
    coverArt: p.coverArt,
    coverSongUid: null,
    createdAt: p.createdAt.toISOString(),
  }
}

function getEntrySongUid(entry: { songmid: string | null; musicInfo?: { data: string | null } | null } | undefined): string | null {
  if (!entry) return null
  if (entry.songmid) return entry.songmid
  if (!entry.musicInfo?.data) return null
  try {
    const musicInfo = JSON.parse(entry.musicInfo.data) as MusicInfo
    return musicInfo.source && musicInfo.songmid ? `${musicInfo.source}-${musicInfo.songmid}` : null
  } catch {
    return null
  }
}

/**
 * 列出用户可见的所有歌单（自己创建 + 公开 + 被授权）。
 */
export async function listPlaylistsForUser(username: string): Promise<PlaylistSummary[]> {
  const rows = await prisma.playlist.findMany({
    where: {
      OR: [{ username }, { isPublic: true }, { allowedUsers: { some: { username } } }],
    },
    include: {
      allowedUsers: true,
      entries: {
        orderBy: { position: 'asc' },
        take: 1,
        select: { songmid: true, musicInfo: { select: { data: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(playlist => ({
    ...toSummary(playlist),
    coverSongUid: getEntrySongUid(playlist.entries[0]),
  }))
}

/**
 * 获取歌单详情（含歌曲）。非公开歌单仅 owner / 被授权用户可访问。
 */
export async function getPlaylistDetail(
  id: number,
  username: string
): Promise<PlaylistDetail | null> {
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      entries: { orderBy: { position: 'asc' }, include: { musicInfo: true } },
      allowedUsers: true,
    },
  })
  if (!playlist) return null

  const isOwner = playlist.username === username
  const isAllowed = playlist.allowedUsers.some(au => au.username === username)
  if (!playlist.isPublic && !isOwner && !isAllowed) {
    return null
  }

  const entries: PlaylistEntryItem[] = []
  for (const e of playlist.entries) {
    let musicInfo: MusicInfo | null = null
    if (e.musicInfo?.data) {
      try {
        musicInfo = JSON.parse(e.musicInfo.data) as MusicInfo
      } catch {
        musicInfo = null
      }
    }
    entries.push({
      position: e.position,
      songId: e.songmid || (musicInfo ? `${musicInfo.source}-${musicInfo.songmid}` : ''),
      musicInfo,
      addedAt: e.addedAt.toISOString(),
      addedBy: e.addedBy,
    })
  }

  return {
    ...toSummary(playlist),
    coverSongUid: entries[0]?.songId || null,
    entries,
    allowedUsers: playlist.allowedUsers.map(au => au.username),
  }
}

/**
 * 获取歌单封面所需的最小数据。供 Subsonic getCoverArt 使用，避免为一张封面加载整张歌单。
 */
export async function getPlaylistCoverForUser(
  id: number,
  username: string
): Promise<PlaylistCoverData | null> {
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      entries: {
        orderBy: { position: 'asc' },
        take: 1,
        include: { musicInfo: true },
      },
      allowedUsers: true,
    },
  })
  if (!playlist) return null

  const isOwner = playlist.username === username
  const isAllowed = playlist.allowedUsers.some(au => au.username === username)
  if (!playlist.isPublic && !isOwner && !isAllowed) return null

  const entry = playlist.entries[0]
  let musicInfo: MusicInfo | null = null
  if (entry?.musicInfo?.data) {
    try {
      musicInfo = JSON.parse(entry.musicInfo.data) as MusicInfo
    } catch {
      musicInfo = null
    }
  }

  return {
    coverArt: playlist.coverArt,
    songId: getEntrySongUid(entry),
    musicInfo,
  }
}

/**
 * 创建歌单。
 */
export async function createPlaylist(username: string, name: string): Promise<PlaylistSummary> {
  const created = await prisma.playlist.create({
    data: {
      name,
      username,
      owner: username,
      isPublic: false,
      songCount: 0,
      duration: 0,
      allowedUsers: { create: { username } },
    },
    include: { allowedUsers: true },
  })
  logger.info(`[playlist] created ${created.id} - ${name}`)
  return toSummary(created)
}

/**
 * 更新歌单元数据（name/comment/isPublic）。仅 owner。
 */
export async function updatePlaylistMeta(
  id: number,
  username: string,
  updates: { name?: string; comment?: string; isPublic?: boolean }
): Promise<void> {
  await assertOwner(id, username)
  const data: Prisma.PlaylistUpdateInput = {}
  if (updates.name !== undefined) data.name = updates.name
  if (updates.comment !== undefined) data.comment = updates.comment
  if (updates.isPublic !== undefined) data.isPublic = updates.isPublic
  if (Object.keys(data).length > 0) {
    await prisma.playlist.update({ where: { id }, data })
  }
}

/**
 * 向歌单添加歌曲（去重，position 追加）。仅 owner。
 * songIds 为 source-{存储songmid} 列表。
 */
export async function addSongsToPlaylist(
  id: number,
  username: string,
  songIds: string[]
): Promise<void> {
  await assertOwner(id, username)

  const maxPosRow = await prisma.playlistEntry.findFirst({
    where: { playlistId: id },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  let pos = maxPosRow?.position ?? 0

  const seen = new Set<string>()
  for (const rawSid of songIds) {
    const sid = String(rawSid).trim()
    if (!sid || seen.has(sid)) continue
    seen.add(sid)

    // 已存在则跳过
    const exists = await prisma.playlistEntry.findFirst({ where: { playlistId: id, songmid: sid } })
    if (exists) continue

    pos++
    // 解析 source-songmid 关联 MusicInfo 行
    let miRow: { id: number } | null = null
    if (sid.includes('-')) {
      const idx = sid.indexOf('-')
      const src = sid.substring(0, idx)
      const mid = sid.substring(idx + 1)
      if (src && mid) {
        miRow = await prisma.musicInfo.findUnique({
          where: { source_songmid: { source: src, songmid: mid } },
          select: { id: true },
        })
      }
    }
    await prisma.playlistEntry.create({
      data: { playlistId: id, musicInfoId: miRow?.id ?? null, songmid: sid, position: pos, addedBy: username },
    })
  }

  await refreshPlaylistStats(id)
}

/**
 * 从歌单移除歌曲（按 position）。仅 owner。删除后重排 position。
 */
export async function removeSongsFromPlaylist(
  id: number,
  username: string,
  positions: number[]
): Promise<void> {
  await assertOwner(id, username)

  for (const pos of positions) {
    await prisma.playlistEntry.deleteMany({ where: { playlistId: id, position: pos } })
  }

  const remaining = await prisma.playlistEntry.findMany({
    where: { playlistId: id },
    orderBy: { position: 'asc' },
  })
  for (let i = 0; i < remaining.length; i++) {
    const newPos = i + 1
    if (remaining[i].position !== newPos) {
      await prisma.playlistEntry.update({
        where: { id: remaining[i].id },
        data: { position: newPos },
      })
    }
  }

  await refreshPlaylistStats(id)
}

/**
 * 删除歌单（级联删除条目与授权）。仅 owner。
 */
export async function deletePlaylist(id: number, username: string): Promise<void> {
  await assertOwner(id, username)
  await prisma.playlist.delete({ where: { id } })
  logger.info(`[playlist] deleted ${id}`)
}

// ---- 内部工具 ----

async function assertOwner(id: number, username: string): Promise<void> {
  const playlist = await prisma.playlist.findUnique({ where: { id }, select: { username: true } })
  if (!playlist) throw new PlaylistError('Playlist not found', 404)
  if (playlist.username !== username) throw new PlaylistError('Access denied', 403)
}

async function refreshPlaylistStats(id: number): Promise<void> {
  const total = await prisma.playlistEntry.count({ where: { playlistId: id } })
  const entries = await prisma.playlistEntry.findMany({
    where: { playlistId: id },
    include: { musicInfo: { select: { durationSeconds: true } } },
  })
  const totalDuration = entries.reduce((acc, e) => acc + (e.musicInfo?.durationSeconds ?? 0), 0)
  await prisma.playlist.update({ where: { id: id }, data: { songCount: total, duration: totalDuration } })
}

export class PlaylistError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}
