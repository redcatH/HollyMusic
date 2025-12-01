import { NextRequest } from 'next/server'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'
import favorites, { FavoriteItem } from './favorites'
import dbAPI from './db'
import { type AuthResult } from './auth'

function parseListParam(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
}

async function ensureSourceForSong(item: FavoriteItem) {
  if (item.source) return item
  try {
    const mi = await dbAPI.getMusicInfoBySongmid(item.itemId)
    if (mi && mi.source) item.source = mi.source
  } catch {
    // ignore errors when attempting to read MusicInfo
  }
  return item
}

export async function handleStar(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const url = new URL(request.url)
    const params = url.searchParams
    const ids = parseListParam(params.get('id'))
    const albumIds = parseListParam(params.get('albumId'))
    const artistIds = parseListParam(params.get('artistId'))
    const sourceParam = params.get('source') || null

    if (ids.length === 0 && albumIds.length === 0 && artistIds.length === 0) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 50, message: 'Required parameter missing: id/albumId/artistId' } })
      return createSubsonicResponse(xml)
    }

    // 用户信息已在 handleMethod 中验证，直接使用
    const userId = authRes.user!.id

    const items: FavoriteItem[] = []
    items.push(...ids.map(id => ({ itemType: 'song' as const, itemId: id, source: sourceParam })))
    items.push(...albumIds.map(id => ({ itemType: 'album' as const, itemId: id, source: sourceParam })))
    items.push(...artistIds.map(id => ({ itemType: 'artist' as const, itemId: id, source: sourceParam })))

    // Resolve source for song items if not provided
    const resolved: FavoriteItem[] = []
    for (const it of items) {
      if (it.itemType === 'song') {
        resolved.push(await ensureSourceForSong(it))
      } else {
        resolved.push(it)
      }
    }

    const { created } = await favorites.starItems(userId, resolved)
    console.debug('[star] created:', created)

    const xml = formatSubsonicXML({ status: 'ok' })
    return createSubsonicResponse(xml)
  } catch (err) {
    console.error('[star] Error:', err)
    const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: 'Internal error' } })
    return createSubsonicResponse(xml)
  }
}

export async function handleUnstar(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const url = new URL(request.url)
    const params = url.searchParams
    const ids = parseListParam(params.get('id'))
    const albumIds = parseListParam(params.get('albumId'))
    const artistIds = parseListParam(params.get('artistId'))
    const sourceParam = params.get('source') || null

    if (ids.length === 0 && albumIds.length === 0 && artistIds.length === 0) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 50, message: 'Required parameter missing: id/albumId/artistId' } })
      return createSubsonicResponse(xml)
    }

    // 用户信息已在 handleMethod 中验证，直接使用
    const userId = authRes.user!.id

    const items: FavoriteItem[] = []
    items.push(...ids.map(id => ({ itemType: 'song' as const, itemId: id, source: sourceParam })))
    items.push(...albumIds.map(id => ({ itemType: 'album' as const, itemId: id, source: sourceParam })))
    items.push(...artistIds.map(id => ({ itemType: 'artist' as const, itemId: id, source: sourceParam })))

    const { deleted } = await favorites.unstarItems(userId, items)
    console.debug('[unstar] deleted:', deleted)

    const xml = formatSubsonicXML({ status: 'ok' })
    return createSubsonicResponse(xml)
  } catch (err) {
    console.error('[unstar] Error:', err)
    const xml = formatSubsonicXML({ status: 'failed', error: { code: 0, message: 'Internal error' } })
    return createSubsonicResponse(xml)
  }
}
