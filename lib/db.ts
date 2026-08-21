/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto'
import { PrismaClient, Prisma } from './generated/prisma'
import { logger } from './logger'
import type { MusicInfo } from './types/music'

export const prisma = new PrismaClient()

function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(v => stableStringify(v)).join(',') + ']'
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

function computeChecksum(mi: MusicInfo) {
  const payload = {
    name: mi.name,
    singer: mi.singer,
    source: mi.source,
    songmid: mi.songmid,
    albumId: mi.albumId || null,
    albumName: mi.albumName || null,
    interval: mi.interval,
    types: mi.types || [],
    _types: mi._types || {},
    typeUrl: mi.typeUrl || {},
    img: mi.img || null,
    hash: (mi as any).hash || null,
    copyrightId: (mi as any).copyrightId || null,
    songId: (mi as any).songId || null,
    strMediaMid: (mi as any).strMediaMid || null,
    albumMid: (mi as any).albumMid || null,
    lrc: mi.lrc || null,
    lrcUrl: mi.lrcUrl || null,
    mrcUrl: mi.mrcUrl || null,
    trcUrl: mi.trcUrl || null,
  }
  const s = stableStringify(payload)
  return crypto.createHash('md5').update(s).digest('hex')
}

export async function getMusicInfo(source: string, songmid: string): Promise<MusicInfo | null> {
  try {
    const row = await prisma.musicInfo.findUnique({
      where: {
        source_songmid: {
          source,
          songmid,
        },
      },
    })
    if (!row || !row.data) return null
    return JSON.parse(row.data) as MusicInfo
  } catch (e) {
    console.warn('getMusicInfo error', e)
    return null
  }
}

/**
 * 统一的 id → MusicInfo 解析入口。
 *
 * 对外 song id 统一为 `source-songmid` 复合格式（见 subsonic-search / subsonic-getstarred），
 * 其中 songmid 为存储键（kg 用 FileHash，其他源用原 songmid，见 getStorageSongmid）。
 * 本函数解析出 (source, songmid) 后走精确匹配 getMusicInfo（findUnique 复合唯一键），
 * 不做全库模糊回退，保证 id → DB 记录的映射唯一正确，避免播错歌。
 *
 * 所有接口（stream/getSong/getCoverArt/getLyrics/getStarred/playlist）都通过此入口解析 id。
 */
export async function resolveMusicInfoById(id: string): Promise<MusicInfo | null> {
  if (!id) return null

  // 按 `source-songmid` 解析（source 为第一个 '-' 之前的部分）
  // kg 的存储键 FileHash 是纯 hex 不含 '-'，其他源的 songmid 也都不含 '-'，故取第一个 '-' 即可
  if (!id.includes('-')) return null
  const idx = id.indexOf('-')
  const src = id.substring(0, idx)
  const mid = id.substring(idx + 1)
  if (!src || !mid) return null

  return getMusicInfo(src, mid)
}

export async function getFirstMusicInfoByAlbumId(albumId: string): Promise<MusicInfo | null> {
  try {
    const row = await prisma.musicInfo.findFirst({
      where: { albumId },
      orderBy: { id: 'asc' },
    })
    if (!row || !row.data) return null
    return JSON.parse(row.data) as MusicInfo
  } catch (e) {
    console.warn('getFirstMusicInfoByAlbumId error', e)
    return null
  }
}

/** 按传统 Subsonic getLyrics 的 artist + title 参数查找已缓存歌曲。 */
export async function getFirstMusicInfoByArtistAndTitle(artist: string, title: string): Promise<MusicInfo | null> {
  try {
    const row = await prisma.musicInfo.findFirst({
      where: {
        name: title,
        singer: artist,
      },
      orderBy: { id: 'asc' },
    })
    if (!row?.data) return null
    return JSON.parse(row.data) as MusicInfo
  } catch (error) {
    logger.warn('getFirstMusicInfoByArtistAndTitle error', error)
    return null
  }
}

/**
 * 按 albumId 查询整专辑所有歌曲（从 data 列还原原始 MusicInfo），按 id asc 排序。
 * 第一首即代表曲（与 getFirstMusicInfoByAlbumId 一致）。
 */
export async function getMusicInfoListByAlbumId(albumId: string): Promise<MusicInfo[]> {
  try {
    const rows = await prisma.musicInfo.findMany({
      where: { albumId },
      orderBy: { id: 'asc' },
    })
    const list: MusicInfo[] = []
    for (const row of rows) {
      if (!row.data) continue
      try {
        list.push(JSON.parse(row.data) as MusicInfo)
      } catch {
        // 跳过解析失败的行
      }
    }
    return list
  } catch (e) {
    console.warn('getMusicInfoListByAlbumId error', e)
    return []
  }
}

/**
 * 从 DB 随机抽取 size 首歌曲（还原为 MusicInfo）。
 * 用于 getRandomSongs 接口：从历史搜索/播放入库的曲目中随机推荐。
 * Prisma 不支持随机排序，用原生 SQL ORDER BY RANDOM()。
 */
export async function getRandomMusicInfoList(size: number, allowedSources?: string[]): Promise<MusicInfo[]> {
  try {
    const limit = Math.max(1, Math.min(size, 500))
    // 只从推荐白名单（isRecommended = 1）抽取，避免推荐到垃圾歌曲；
    // 同时按 allowedSources 过滤为启用音源，保证抽出的歌可播放
    const rows = allowedSources && allowedSources.length > 0
      ? await prisma.$queryRaw<{ data: string | null }[]>`
          SELECT data FROM MusicInfo WHERE source IN (${Prisma.join(allowedSources)}) AND isRecommended = 1 ORDER BY RANDOM() LIMIT ${limit}
        `
      : await prisma.$queryRaw<{ data: string | null }[]>`
          SELECT data FROM MusicInfo WHERE isRecommended = 1 ORDER BY RANDOM() LIMIT ${limit}
        `
    const list: MusicInfo[] = []
    for (const row of rows) {
      if (!row.data) continue
      try {
        list.push(JSON.parse(row.data) as MusicInfo)
      } catch {
        // 跳过解析失败的行
      }
    }
    return list
  } catch (e) {
    console.warn('getRandomMusicInfoList error', e)
    return []
  }
}

/**
 * 推荐歌曲精简视图（用于管理后台列表展示，直接查反范式列，不解析 data JSON）。
 */
export interface RecommendedSongView {
  uid: string
  source: string
  name: string | null
  singer: string | null
  img: string | null
  albumName: string | null
  updatedAt: Date
}

/**
 * 列出推荐白名单中的歌曲（分页，按 updatedAt 倒序）。
 */
export async function listRecommendedMusicInfo(
  page = 1,
  limit = 50,
  opts?: { keyword?: string; sortBy?: 'updatedAt' | 'name' | 'singer'; sortOrder?: 'asc' | 'desc' },
): Promise<{ list: RecommendedSongView[]; total: number }> {
  try {
    const take = Math.max(1, Math.min(limit, 200))
    const skip = Math.max(0, page - 1) * take
    const keyword = opts?.keyword?.trim()
    const where = {
      isRecommended: true,
      ...(keyword
        ? { OR: [{ name: { contains: keyword } }, { singer: { contains: keyword } }] }
        : {}),
    }
    const sortBy = opts?.sortBy ?? 'updatedAt'
    const sortOrder = opts?.sortOrder === 'asc' ? 'asc' : 'desc'
    const [rows, total] = await Promise.all([
      prisma.musicInfo.findMany({
        where,
        orderBy: { [sortBy]: sortOrder } as Prisma.MusicInfoOrderByWithRelationInput,
        skip,
        take,
        select: {
          source: true,
          songmid: true,
          name: true,
          singer: true,
          img: true,
          albumName: true,
          updatedAt: true,
        },
      }),
      prisma.musicInfo.count({ where }),
    ])
    const list: RecommendedSongView[] = rows.map(r => ({
      uid: `${r.source}-${r.songmid}`,
      source: r.source,
      name: r.name,
      singer: r.singer,
      img: r.img,
      albumName: r.albumName,
      updatedAt: r.updatedAt,
    }))
    return { list, total }
  } catch (e) {
    console.warn('listRecommendedMusicInfo error', e)
    return { list: [], total: 0 }
  }
}

/**
 * 解析对外 uid（`source-{存储songmid}`）为 (source, songmid)。
 * 与 resolveMusicInfoById 一致：取第一个 '-' 分隔，保证 kg 的 FileHash（纯 hex）正确解析。
 */
function parseUid(uid: string): { source: string; songmid: string } | null {
  if (!uid || !uid.includes('-')) return null
  const idx = uid.indexOf('-')
  const source = uid.substring(0, idx)
  const songmid = uid.substring(idx + 1)
  if (!source || !songmid) return null
  return { source, songmid }
}

/**
 * 设置单首歌曲的推荐状态。记录不存在返回 updated: 0。
 */
export async function setRecommendedStatus(uid: string, value: boolean): Promise<{ updated: number }> {
  const parsed = parseUid(uid)
  if (!parsed) return { updated: 0 }
  try {
    await prisma.musicInfo.update({
      where: { source_songmid: { source: parsed.source, songmid: parsed.songmid } },
      data: { isRecommended: value },
    })
    return { updated: 1 }
  } catch (e) {
    // Prisma P2025: 记录不存在（update 的 where 未命中）
    console.warn('setRecommendedStatus error', e)
    return { updated: 0 }
  }
}

/**
 * 批量设置推荐状态（并行）。返回成功更新的数量。
 */
export async function setRecommendedBatch(uids: string[], value: boolean): Promise<{ updated: number }> {
  if (!Array.isArray(uids) || uids.length === 0) return { updated: 0 }
  const results = await Promise.all(uids.map(uid => setRecommendedStatus(uid, value)))
  return { updated: results.reduce((sum, r) => sum + r.updated, 0) }
}

/**
 * 清空全部推荐（一条 SQL，不先查 uid）。返回取消的条数。
 */
export async function clearAllRecommended(): Promise<{ updated: number }> {
  const result = await prisma.musicInfo.updateMany({
    where: { isRecommended: true },
    data: { isRecommended: false },
  })
  return { updated: result.count }
}

/**
 * 计算用于 DB 查询/对外 id 的 songmid（存储键）。
 *
 * 关键设计：分离"原始数据"与"查询键"。
 * - `data` 列存原始 musicInfo（songmid 保持各音源原值，如 kg 的 Audioid），
 *   播放时从 data 列拉起原始数据，保证外部脚本拿到正确的结构。
 * - `songmid` 列（复合唯一键的一部分、对外 id 的一部分）存"存储键"：
 *   kg 源的 Audioid 不唯一（同一首歌多个版本 Audioid 相同但 FileHash 不同），
 *   故 kg 用 FileHash 作存储键以保证 (source, songmid) 真正唯一；
 *   其他源的原始 songmid 已唯一，直接用。
 *
 * 这样对外 id = `source-{存储songmid}`，resolveMusicInfoById 解析后用 (source, 存储songmid)
 * 精确命中 DB 行，再从 data 列读出原始 musicInfo。
 */
function getStorageSongmid(mi: MusicInfo): string {
  if (mi.source === 'kg') {
    // kg 优先用 FileHash（唯一），回退到原 songmid
    const hash = (mi as any).hash
    if (hash) return String(hash)
  }
  return String(mi.songmid)
}

/**
 * 计算对外 id 用的 songmid（存储键）。
 * 供 search/getStarred 等输出 song id 时使用，保证 id 与 DB 的 songmid 列一致，
 * 使 resolveMusicInfoById 能精确命中。
 */
export function getStorageSongmidForMusicInfo(mi: MusicInfo): string {
  return getStorageSongmid(mi)
}

export async function upsertMusicInfo(mi: MusicInfo): Promise<{ action: 'insert' | 'update' | 'noop' }> {
  try {
    const checksum = computeChecksum(mi)
    const dataJson = JSON.stringify(mi)
    // 存储键：kg 用 FileHash，其他源用原 songmid（详见 getStorageSongmid）
    const storageSongmid = getStorageSongmid(mi)

    const existing = await prisma.musicInfo.findUnique({
      where: {
        source_songmid: {
          source: mi.source,
          songmid: storageSongmid,
        },
      },
      select: {
        checksum: true,
      },
    })

    if (!existing) {
      const durationSeconds = (() => {
        const n = Number(mi.interval)
        return Number.isNaN(n) ? null : n
      })()

      await prisma.musicInfo.create({
        data: {
          source: mi.source,
          songmid: storageSongmid,
          data: dataJson,
          checksum,
          // denormalized/searchable fields
          name: mi.name || null,
          singer: mi.singer || null,
          albumId: mi.albumId != null ? String(mi.albumId) : null,
          albumName: mi.albumName || null,
          img: (mi as any).img || null,
          durationSeconds,

          // source-specific identifiers
          songId: (mi as any).songId != null ? String((mi as any).songId) : null,
          albumMid: (mi as any).albumMid != null ? String((mi as any).albumMid) : null,
          strMediaMid: (mi as any).strMediaMid != null ? String((mi as any).strMediaMid) : null,
          hash: (mi as any).hash || null,
          copyrightId: (mi as any).copyrightId != null ? String((mi as any).copyrightId) : null,

          // structured JSON stored as text for SQLite
          typesJson: JSON.stringify(mi.types || []),
          typesMapJson: JSON.stringify(mi._types || {}),
          typeUrlJson: JSON.stringify(mi.typeUrl || {}),

          // lyrics / resource urls
          lrc: (mi as any).lrc || null,
          lrcUrl: (mi as any).lrcUrl || null,
          mrcUrl: (mi as any).mrcUrl || null,
          trcUrl: (mi as any).trcUrl || null,
        },
      })
      return { action: 'insert' }
    }

    if (existing.checksum === checksum) {
      return { action: 'noop' }
    }

    const durationSeconds = (() => {
      const n = Number(mi.interval)
      return Number.isNaN(n) ? null : n
    })()

    await prisma.musicInfo.update({
      where: {
        source_songmid: {
          source: mi.source,
          songmid: storageSongmid,
        },
      },
      data: {
        data: dataJson,
        checksum,
        // update denormalized/searchable fields as above
        name: mi.name || null,
        singer: mi.singer || null,
        albumId: mi.albumId != null ? String(mi.albumId) : null,
        albumName: mi.albumName || null,
        img: (mi as any).img || null,
        durationSeconds,

        songId: (mi as any).songId != null ? String((mi as any).songId) : null,
        albumMid: (mi as any).albumMid != null ? String((mi as any).albumMid) : null,
        strMediaMid: (mi as any).strMediaMid != null ? String((mi as any).strMediaMid) : null,
        hash: (mi as any).hash || null,
        copyrightId: (mi as any).copyrightId != null ? String((mi as any).copyrightId) : null,

        typesJson: JSON.stringify(mi.types || []),
        typesMapJson: JSON.stringify(mi._types || {}),
        typeUrlJson: JSON.stringify(mi.typeUrl || {}),

        lrc: (mi as any).lrc || null,
        lrcUrl: (mi as any).lrcUrl || null,
        mrcUrl: (mi as any).mrcUrl || null,
        trcUrl: (mi as any).trcUrl || null,
      },
    })
    return { action: 'update' }
  } catch (e) {
    console.error('upsertMusicInfo error', e)
    return { action: 'noop' }
  }
}

const dbAPI = {
  getMusicInfo,
  getFirstMusicInfoByAlbumId,
  getFirstMusicInfoByArtistAndTitle,
  getMusicInfoListByAlbumId,
  getRandomMusicInfoList,
  upsertMusicInfo,
  resolveMusicInfoById,
  listRecommendedMusicInfo,
  setRecommendedStatus,
  setRecommendedBatch,
}

export default dbAPI
