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
    if (mi?.source) {
      item.source = mi.source
      console.log('[star] Resolved source for song', item.itemId, 'source:', item.source)
    } else {
      console.warn('[star] Could not resolve source for song', item.itemId)
    }
  } catch (err) {
    console.warn('[star] Error resolving source for song', item.itemId, err)
  }
  
  return item
}

export async function handleStar(request: NextRequest, authRes: AuthResult): Promise<Response> {
  try {
    const url = new URL(request.url)
    const params = url.searchParams
    const ids = parseListParam(params.get('id'))

    if (ids.length === 0) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 50, message: 'Required parameter missing: id' } })
      return createSubsonicResponse(xml)
    }

    const userId = authRes.user!.id

    // Create song items - source must be resolved from database since client doesn't provide it
    const items: FavoriteItem[] = ids.map(id => ({ itemType: 'song' as const, itemId: id, source: null }))

    // Resolve source for all song items from database
    const resolved: FavoriteItem[] = []
    for (const it of items) {
      resolved.push(await ensureSourceForSong(it))
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

    if (ids.length === 0) {
      const xml = formatSubsonicXML({ status: 'failed', error: { code: 10, message: 'Required parameter missing: id' } })
      return createSubsonicResponse(xml)
    }

    const userId = authRes.user!.id

    // Create song items without source - will delete all matching records for this userId + itemId
    const items: FavoriteItem[] = ids.map(id => ({ itemType: 'song' as const, itemId: id, source: null }))

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

