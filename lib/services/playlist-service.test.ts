/**
 * lib/services/playlist-service.ts 测试
 *
 * P1b 回归守卫：
 * - addSongsToPlaylist / removeSongsFromPlaylist 在交互式事务中执行；
 * - 撞唯一约束（P2002）时整体重试，其他错误如实上抛；
 * - position 追加与删除后压缩重排正确。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  playlistFindUnique: vi.fn(),
  playlistUpdate: vi.fn(),
  entryFindFirst: vi.fn(),
  entryFindMany: vi.fn(),
  entryCreate: vi.fn(),
  entryDeleteMany: vi.fn(),
  entryUpdate: vi.fn(),
  entryCount: vi.fn(),
  musicInfoFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../generated/prisma', () => ({
  PrismaClient: class {
    playlist = { findUnique: m.playlistFindUnique, update: m.playlistUpdate }
    playlistEntry = {
      findFirst: m.entryFindFirst,
      findMany: m.entryFindMany,
      create: m.entryCreate,
      deleteMany: m.entryDeleteMany,
      update: m.entryUpdate,
      count: m.entryCount,
    }
    musicInfo = { findUnique: m.musicInfoFindUnique }
    $transaction = m.transaction
  },
  Prisma: {},
}))

const { addSongsToPlaylist, removeSongsFromPlaylist, PlaylistError } = await import(
  './playlist-service'
)

/** 事务内 tx 客户端：与外层 mock 共用同一组 spy */
const txClient = {
  playlistEntry: {
    findFirst: m.entryFindFirst,
    findMany: m.entryFindMany,
    create: m.entryCreate,
    deleteMany: m.entryDeleteMany,
    update: m.entryUpdate,
  },
  musicInfo: { findUnique: m.musicInfoFindUnique },
}

beforeEach(() => {
  vi.clearAllMocks()
  m.transaction.mockImplementation(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient))
  // 默认通过 owner 校验
  m.playlistFindUnique.mockResolvedValue({ username: 'tester' })
  // stats 刷新的默认返回
  m.entryCount.mockResolvedValue(0)
  m.entryFindMany.mockResolvedValue([])
  m.entryDeleteMany.mockResolvedValue({ count: 0 })
  m.entryCreate.mockResolvedValue({ id: 100 })
  m.entryUpdate.mockResolvedValue({})
  m.playlistUpdate.mockResolvedValue({})
  m.musicInfoFindUnique.mockResolvedValue({ id: 9 })
})

describe('addSongsToPlaylist（P1b 事务化）', () => {
  it('在事务中执行，position 在最大值上追加', async () => {
    // 第一次 findFirst：取最大 position；后续：查重（不存在）
    m.entryFindFirst
      .mockResolvedValueOnce({ position: 5 })
      .mockResolvedValue(null)

    await addSongsToPlaylist(1, 'tester', ['kw-123'])

    expect(m.transaction).toHaveBeenCalledTimes(1)
    expect(m.entryCreate).toHaveBeenCalledWith({
      data: { playlistId: 1, musicInfoId: 9, songmid: 'kw-123', position: 6, addedBy: 'tester' },
    })
  })

  it('同一批内重复 songId 只添加一次', async () => {
    m.entryFindFirst.mockResolvedValue(null) // 无历史条目

    await addSongsToPlaylist(1, 'tester', ['kw-1', 'kw-1'])

    expect(m.entryCreate).toHaveBeenCalledTimes(1)
    expect(m.entryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ songmid: 'kw-1', position: 1 }),
    })
  })

  it('歌单内已存在的歌曲跳过（按 songmid 查重）', async () => {
    m.entryFindFirst
      .mockResolvedValueOnce({ position: 2 }) // maxPos
      .mockResolvedValueOnce({ id: 50 }) // 查重：已存在

    await addSongsToPlaylist(1, 'tester', ['kw-exist'])

    expect(m.entryCreate).not.toHaveBeenCalled()
  })

  it('唯一约束冲突（P2002）整体重试后成功', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    m.entryFindFirst.mockResolvedValue(null)
    m.entryCreate
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: 100 })

    await addSongsToPlaylist(1, 'tester', ['kw-123'])

    // 第一次事务撞 P2002 → 重试第二个事务成功
    expect(m.transaction).toHaveBeenCalledTimes(2)
    expect(m.entryCreate).toHaveBeenCalledTimes(2)
  })

  it('非唯一约束错误不重试，如实上抛', async () => {
    m.entryFindFirst.mockResolvedValue(null)
    m.entryCreate.mockRejectedValue(new Error('SQLITE_IOERR'))

    await expect(addSongsToPlaylist(1, 'tester', ['kw-123'])).rejects.toThrow('SQLITE_IOERR')
    expect(m.transaction).toHaveBeenCalledTimes(1)
  })

  it('非 owner 拒绝（403）', async () => {
    m.playlistFindUnique.mockResolvedValue({ username: 'someone-else' })

    await expect(addSongsToPlaylist(1, 'tester', ['kw-1'])).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(m.entryCreate).not.toHaveBeenCalled()
  })
})

describe('removeSongsFromPlaylist（重排正确性）', () => {
  it('删除后剩余条目压缩重排为 1..N，且在事务中执行', async () => {
    // 删掉 position 1 后剩余 [2, 3, 5]
    m.entryFindMany
      .mockResolvedValueOnce([
        { id: 21, position: 2 },
        { id: 31, position: 3 },
        { id: 51, position: 5 },
      ])
      .mockResolvedValue([]) // stats 刷新读取

    await removeSongsFromPlaylist(1, 'tester', [1])

    expect(m.transaction).toHaveBeenCalledTimes(1)
    expect(m.entryDeleteMany).toHaveBeenCalledWith({ where: { playlistId: 1, position: 1 } })
    expect(m.entryUpdate).toHaveBeenCalledTimes(3)
    expect(m.entryUpdate).toHaveBeenNthCalledWith(1, { where: { id: 21 }, data: { position: 1 } })
    expect(m.entryUpdate).toHaveBeenNthCalledWith(2, { where: { id: 31 }, data: { position: 2 } })
    expect(m.entryUpdate).toHaveBeenNthCalledWith(3, { where: { id: 51 }, data: { position: 3 } })
  })

  it('position 已连续时跳过无谓的重排 update', async () => {
    m.entryFindMany
      .mockResolvedValueOnce([
        { id: 1, position: 1 },
        { id: 2, position: 2 },
      ])
      .mockResolvedValue([])

    await removeSongsFromPlaylist(1, 'tester', [5])

    expect(m.entryUpdate).not.toHaveBeenCalled()
  })

  it('歌单不存在抛 404', async () => {
    m.playlistFindUnique.mockResolvedValue(null)

    await expect(removeSongsFromPlaylist(99, 'tester', [1])).rejects.toBeInstanceOf(PlaylistError)
  })
})
