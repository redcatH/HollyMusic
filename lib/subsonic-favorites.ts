import { NextRequest } from 'next/server'
import { formatSubsonicXML, createSubsonicResponse } from './subsonic'
import favorites, { FavoriteItem } from './favorites'
import { type AuthResult } from './auth'

function parseListParam(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
}

/**
 * 从 `source-songmid` 复合 id 解析出 source。
 * song id 统一为该格式（见 subsonic-search / subsonic-getstarred），source 为第一个 '-' 之前的部分。
 */
function parseSourceFromId(id: string): string | null {
  if (!id.includes('-')) return null
  const src = id.substring(0, id.indexOf('-'))
  return src || null
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

    // song id 统一为 `source-songmid` 复合格式，直接从 id 解析出 source
    const items: FavoriteItem[] = ids.map(id => ({
      itemType: 'song' as const,
      itemId: id,
      source: parseSourceFromId(id),
    }))

    const { created } = await favorites.starItems(userId, items)
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

