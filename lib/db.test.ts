import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findUnique, create, update } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('./generated/prisma', () => ({
  PrismaClient: class {
    musicInfo = { findUnique, create, update }
  },
  Prisma: {},
}))
vi.mock('./logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

const { upsertMusicInfo } = await import('./db')

const musicInfo = {
  source: 'kw' as const,
  songmid: '123',
  name: '测试歌曲',
  singer: '测试歌手',
  interval: '3:00',
  types: [],
  _types: {},
  typeUrl: {},
}

describe('upsertMusicInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('并发插入触发 P2002 时重新读取并更新，而不是记录为入库错误', async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ checksum: 'outdated-checksum' })
    create.mockRejectedValueOnce(Object.assign(new Error('unique constraint'), { code: 'P2002' }))
    update.mockResolvedValueOnce({})

    await expect(upsertMusicInfo(musicInfo)).resolves.toEqual({ action: 'update' })

    expect(findUnique).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
