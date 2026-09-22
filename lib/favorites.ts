import crypto from 'crypto'
import { PrismaClient } from './generated/prisma'
import { logger } from './logger'

const prisma = new PrismaClient()

/** Prisma P2002：唯一约束冲突。duck-typing 判定，避免对生成客户端的类依赖。 */
function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

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

  let created = 0
  for (const item of items) {
    if (!item.itemId) {
      logger.warn('[starItems] skip item without itemId', item)
      continue
    }
    const source = item.source ?? null
    try {
      if (source === null) {
        // SQLite 的 UNIQUE 索引对 NULL 不去重（NULL 互不相等），并发下可插入重复行。
        // 事务内先清同 key 旧行再插入，保证 source 为 NULL 时也原子去重。
        await prisma.$transaction([
          prisma.favorite.deleteMany({
            where: { userId, itemType: item.itemType, itemId: item.itemId, source: null },
          }),
          prisma.favorite.create({
            data: { userId, itemType: item.itemType, itemId: item.itemId, source: null },
          }),
        ])
      } else {
        // create 本身原子：已收藏时触发唯一约束 P2002 → 幂等跳过，无需先查后插
        await prisma.favorite.create({
          data: { userId, itemType: item.itemType, itemId: item.itemId, source },
        })
      }
      created++
    } catch (err) {
      if (isUniqueConstraintError(err)) continue // 已收藏，幂等
      // 其余错误（DB 故障等）如实上抛，不再吞掉伪装成功
      throw err
    }
  }
  return { created }
}

export async function unstarItems(userId: number, items: FavoriteItem[]) {
  if (!items || items.length === 0) {
    logger.warn('[unstarItems] called with empty items array')
    return { deleted: 0 }
  }

  let totalDeleted = 0

  for (const item of items) {
    if (!item.itemId) {
      logger.warn('[unstarItems] skip item without itemId', item)
      continue
    }

    // 精确按 (userId, itemType, itemId) 删除，刻意不带 source：
    // - 收藏时 source 存解析值（如 'kw'），取消收藏的调用方常传 null，
    //   SQLite 中 `source = NULL` 匹配不到任何行，带上 source 会删不掉（70aead2 的教训）；
    // - 必须带 itemType：Favorite 同时支持 song/album/artist，
    //   只按 userId+itemId 删会把 itemId 撞车的其他类型收藏一并误删。
    const res = await prisma.favorite.deleteMany({
      where: {
        userId,
        itemType: item.itemType,
        itemId: item.itemId,
      },
    })
    logger.info(
      `[unstarItems] deleted ${res.count} rows for userId=${userId} itemType=${item.itemType} itemId=${item.itemId}`
    )
    totalDeleted += res.count
  }

  return { deleted: totalDeleted }
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
