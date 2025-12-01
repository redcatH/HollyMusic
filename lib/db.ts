/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto'
import { PrismaClient } from './generated/prisma'
import type { MusicInfo } from './types/music'

const prisma = new PrismaClient()

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

export async function getMusicInfoBySongmid(songmid: string): Promise<MusicInfo | null> {
  try {
    const row = await prisma.musicInfo.findFirst({
      where: {
        songmid,
      },
    })
    if (!row || !row.data) return null
    return JSON.parse(row.data) as MusicInfo
  } catch (e) {
    console.warn('getMusicInfoBySongmid error', e)
    return null
  }
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

export async function upsertMusicInfo(mi: MusicInfo): Promise<{ action: 'insert' | 'update' | 'noop' }> {
  try {
    const checksum = computeChecksum(mi)
    const dataJson = JSON.stringify(mi)

    const existing = await prisma.musicInfo.findUnique({
      where: {
        source_songmid: {
          source: mi.source,
          songmid: mi.songmid,
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
          songmid: mi.songmid,
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
          songmid: mi.songmid,
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
  getMusicInfoBySongmid,
  getFirstMusicInfoByAlbumId,
  upsertMusicInfo,
}

export default dbAPI
