import crypto from 'crypto'
import { PrismaClient } from './generated/prisma'

const prisma = new PrismaClient()

export type ItemType = 'song' | 'album' | 'artist'
export type FavoriteItem = { itemType: ItemType; itemId: string; source?: string | null }

export async function getOrCreateUserByName(username: string) {
  const name = (username || '').trim()
  if (!name) throw new Error('username required')

  let user = await prisma.user.findUnique({ where: { username: name } })
  if (!user) {
    user = await prisma.user.create({ data: { username: name } })
  }
  return user
}

export async function verifyTForUser(username: string, t: string | null | undefined, s: string | null | undefined): Promise<boolean> {
  if (!t || !s) return false
  const name = (username || '').trim()
  if (!name) return false

  const user = await prisma.user.findUnique({ where: { username: name }, select: { subsonicSecret: true } })
  if (!user || !user.subsonicSecret) return false

  const expected = crypto.createHash('md5').update(String(user.subsonicSecret) + String(s)).digest('hex')
  try {
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(String(t), 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function starItems(userId: number, items: FavoriteItem[]) {
  if (!items || items.length === 0) return { created: 0 }

  // Use upsert for each item to make operation idempotent (Prisma v5 doesn't support skipDuplicates)
  // Note: We try upsert first; if unique constraint fails (e.g., when source is null in SQLite),
  // we fall back to checking existence
  let created = 0
  for (const item of items) {
    try {
      const source = item.source ?? null
      const existing = await prisma.favorite.findFirst({
        where: { userId, itemType: item.itemType, itemId: item.itemId, source },
      })
      if (!existing) {
        await prisma.favorite.create({
          data: { userId, itemType: item.itemType, itemId: item.itemId, source },
        })
        created++
      }
    } catch (err) {
      // ignore constraint/uniqueness errors
      console.warn('[starItems] error for item', item, err)
    }
  }
  return { created }
}

export async function unstarItems(userId: number, items: FavoriteItem[]) {
  if (!items || items.length === 0) return { deleted: 0 }

  // Build OR conditions
  const or = items.map(i => ({ itemType: i.itemType, itemId: i.itemId, source: i.source ?? null }))

  const res = await prisma.favorite.deleteMany({ where: { userId, OR: or } })
  return { deleted: res.count }
}

export async function listFavorites(userId: number, opts?: { itemType?: ItemType; limit?: number; offset?: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { userId }
  if (opts?.itemType) where.itemType = opts.itemType

  const rows = await prisma.favorite.findMany({ where, orderBy: { createdAt: 'desc' }, take: opts?.limit ?? 100, skip: opts?.offset ?? 0 })
  return rows
}

// note: user-specific helpers (like updateLastLogin) moved to lib/user.ts
const favoritesApi = {
  getOrCreateUserByName,
  verifyTForUser,
  starItems,
  unstarItems,
  listFavorites,
}

export default favoritesApi
