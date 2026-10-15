import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { syncUsers, ensureAdmin, status, logger } = vi.hoisted(() => ({
  syncUsers: vi.fn(), ensureAdmin: vi.fn(), status: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn() },
}))
vi.mock('@/lib/config-sync', () => ({ syncUsersFromConfig: syncUsers, ensureInitialAdmin: ensureAdmin }))
vi.mock('@/lib/services/initialization', () => ({ getInitializationStatus: status }))
vi.mock('@/lib/logger', () => ({ logger }))
const { register } = await import('../instrumentation')

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  vi.stubEnv('NEXT_PHASE', 'phase-production-server')
  syncUsers.mockResolvedValue({ imported: 0, created: [] })
  status.mockResolvedValue({ setupRequired: false, setupRecoveryRequired: false })
})
afterEach(() => vi.unstubAllEnvs())

describe('服务启动初始化', () => {
  it('空库保留网页设置入口，不再创建或打印随机管理员密码', async () => {
    status.mockResolvedValue({ setupRequired: true, setupRecoveryRequired: false })
    await register()
    expect(ensureAdmin).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('请打开网站'))
  })
  it('旧管理员直接使用，不重置账户', async () => {
    await register()
    expect(syncUsers).toHaveBeenCalledOnce()
    expect(ensureAdmin).not.toHaveBeenCalled()
  })
  it('历史数据缺少管理员时要求恢复，不开放匿名设置', async () => {
    status.mockResolvedValue({ setupRequired: false, setupRecoveryRequired: true })
    await register()
    expect(ensureAdmin).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('恢复管理员'))
  })
  it('保留显式普通用户配置的历史管理员兜底行为', async () => {
    syncUsers.mockResolvedValue({ imported: 1, created: ['alice'] })
    status.mockResolvedValueOnce({ setupRequired: false, setupRecoveryRequired: true })
      .mockResolvedValueOnce({ setupRequired: false, setupRecoveryRequired: false })
    await register()
    expect(ensureAdmin).toHaveBeenCalledOnce()
    expect(status).toHaveBeenCalledTimes(2)
  })
  it('数据库错误会终止启动，不假装为首次安装', async () => {
    status.mockRejectedValue(new Error('migration missing'))
    await expect(register()).rejects.toThrow('migration missing')
    expect(ensureAdmin).not.toHaveBeenCalled()
  })
  it('构建期间完全跳过用户配置和数据库操作', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    await register()
    expect(syncUsers).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
  })
})
