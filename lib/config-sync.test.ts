import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSync, readFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

const user = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('fs', () => ({ existsSync, readFileSync }))
vi.mock('./generated/prisma', () => ({
  PrismaClient: class MockPrismaClient {
    user = user
  },
}))
vi.mock('@/lib/logger', () => ({ logger }))

const { ensureInitialAdmin, syncUsersFromConfig } = await import('./config-sync')

describe('config-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    existsSync.mockReturnValue(true)
    user.findMany.mockResolvedValue([])
  })

  it('缺少 users.json 时只跳过导入，不写入密码配置', async () => {
    existsSync.mockReturnValue(false)

    await expect(syncUsersFromConfig('/tmp/users.json')).resolves.toEqual({ imported: 0, created: [] })

    expect(readFileSync).not.toHaveBeenCalled()
    expect(user.create).not.toHaveBeenCalled()
  })

  it('导入显式 admin 与普通用户，随后兜底不会重复创建 admin', async () => {
    readFileSync.mockReturnValue(JSON.stringify({
      users: [
        { username: 'admin', password: '123456' },
        { username: 'alice', password: 'alice-password' },
      ],
    }))
    user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, username: 'admin' })
    user.create.mockResolvedValue({})

    await expect(syncUsersFromConfig('/tmp/users.json')).resolves.toEqual({
      imported: 2,
      created: ['admin', 'alice'],
    })
    await expect(ensureInitialAdmin()).resolves.toEqual({ created: false, username: 'admin' })

    expect(user.create).toHaveBeenCalledTimes(2)
    expect(user.create).toHaveBeenNthCalledWith(1, {
      data: { username: 'admin', subsonicSecret: '123456', mustChangePassword: true },
    })
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('随机初始密码'))
  })

  it('没有 admin 时创建随机管理员并只输出一次密码', async () => {
    user.findUnique.mockResolvedValue(null)
    user.create.mockResolvedValue({})

    await expect(ensureInitialAdmin()).resolves.toEqual({ created: true, username: 'admin' })

    expect(user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: 'admin', mustChangePassword: true }),
    })
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/^\[config-sync\] 随机初始密码: /))
  })

  it('拒绝 users.json 中的重复用户名', async () => {
    readFileSync.mockReturnValue(JSON.stringify({
      users: [
        { username: 'admin', password: '123456' },
        { username: 'admin', password: 'another-password' },
      ],
    }))
    user.findUnique.mockResolvedValue(null)
    user.create.mockResolvedValue({})

    await expect(syncUsersFromConfig('/tmp/users.json')).rejects.toThrow('重复用户名: admin')
  })
})
