/**
 * lib/favorites.ts 数据层测试
 *
 * 重点回归守卫：
 * 1. unstarItems 按 (userId, itemType, itemId) 精确删除 ——
 *    历史 bug：只按 userId+itemId 宽松删除会误删 itemId 撞车的 album/artist 收藏；
 *    更早的四字段精确匹配又因 source NULL 语义删不掉（70aead2）。
 * 2. starItems 原子化：P2002 幂等跳过、真实错误上抛、source 为 NULL 时事务去重。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { favoriteCreate, favoriteDeleteMany, prismaTransaction } = vi.hoisted(() => ({
  favoriteCreate: vi.fn(),
  favoriteDeleteMany: vi.fn(),
  prismaTransaction: vi.fn(),
}))

vi.mock('./generated/prisma', () => ({
  PrismaClient: class {
    favorite = { create: favoriteCreate, deleteMany: favoriteDeleteMany }
    $transaction = prismaTransaction
  },
}))

const { starItems, unstarItems } = await import('./favorites')

// 数组形式事务：真实 Prisma 顺序执行操作数组，这里等价 Promise.all
beforeEach(() => {
  vi.clearAllMocks()
  prismaTransaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops))
  favoriteDeleteMany.mockResolvedValue({ count: 0 })
  favoriteCreate.mockResolvedValue({ id: 1 })
})

describe('unstarItems', () => {
  it('按 (userId, itemType, itemId) 精确删除：带 itemType、不带 source', async () => {
    favoriteDeleteMany.mockResolvedValue({ count: 1 })

    const res = await unstarItems(1, [{ itemType: 'song', itemId: 'kw-123', source: null }])

    expect(res).toEqual({ deleted: 1 })
    // source 刻意不参与删除条件（收藏存解析值、取消常传 null，=NULL 匹配不到行）
    expect(favoriteDeleteMany).toHaveBeenCalledWith({
      where: { userId: 1, itemType: 'song', itemId: 'kw-123' },
    })
  })

  it('不连带删除 itemId 相同的其他类型收藏（itemType 隔离）', async () => {
    await unstarItems(1, [{ itemType: 'song', itemId: 'same-id', source: 'kw' }])

    const where = favoriteDeleteMany.mock.calls[0][0].where
    expect(where.itemType).toBe('song')
    expect(where.itemId).toBe('same-id')
    // 只有一条 deleteMany，不按 itemId 全类型清扫
    expect(favoriteDeleteMany).toHaveBeenCalledTimes(1)
  })

  it('空 items 数组直接返回，不触发删除', async () => {
    const res = await unstarItems(1, [])
    expect(res).toEqual({ deleted: 0 })
    expect(favoriteDeleteMany).not.toHaveBeenCalled()
  })

  it('跳过缺少 itemId 的条目', async () => {
    const res = await unstarItems(1, [
      { itemType: 'song', itemId: '', source: null },
      { itemType: 'song', itemId: 'kw-1', source: null },
    ])
    expect(favoriteDeleteMany).toHaveBeenCalledTimes(1)
    expect(res.deleted).toBe(0)
  })
})

describe('starItems', () => {
  it('source 非空：单条原子 create，无先查后插', async () => {
    const res = await starItems(1, [{ itemType: 'song', itemId: 'kw-123', source: 'kw' }])

    expect(res).toEqual({ created: 1 })
    expect(favoriteCreate).toHaveBeenCalledWith({
      data: { userId: 1, itemType: 'song', itemId: 'kw-123', source: 'kw' },
    })
    expect(prismaTransaction).not.toHaveBeenCalled()
  })

  it('唯一约束冲突（P2002）幂等跳过，不抛错', async () => {
    favoriteCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

    const res = await starItems(1, [{ itemType: 'song', itemId: 'kw-123', source: 'kw' }])

    expect(res).toEqual({ created: 0 })
  })

  it('真实 DB 错误如实上抛，不再吞错伪装成功', async () => {
    favoriteCreate.mockRejectedValue(new Error(' SQLITE_BUSY'))

    await expect(
      starItems(1, [{ itemType: 'song', itemId: 'kw-123', source: 'kw' }])
    ).rejects.toThrow('SQLITE_BUSY')
  })

  it('source 为 NULL：事务内先清同 key 旧行再插入（SQLite NULL 不去重）', async () => {
    const res = await starItems(1, [{ itemType: 'song', itemId: 'legacy-id', source: null }])

    expect(res).toEqual({ created: 1 })
    expect(prismaTransaction).toHaveBeenCalledTimes(1)
    expect(favoriteDeleteMany).toHaveBeenCalledWith({
      where: { userId: 1, itemType: 'song', itemId: 'legacy-id', source: null },
    })
    expect(favoriteCreate).toHaveBeenCalledWith({
      data: { userId: 1, itemType: 'song', itemId: 'legacy-id', source: null },
    })
  })
})
