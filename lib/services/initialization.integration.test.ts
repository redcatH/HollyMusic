import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '../generated/prisma'

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'holly-setup-'))
const databaseUrl = `file:${path.join(fixtureRoot, 'current.db').replace(/\\/g, '/')}`
vi.stubEnv('DATABASE_URL', databaseUrl)
const { prisma } = await import('../db')
const { completeInitialization, getInitializationStatus } = await import('./initialization')
const { getSystemSetting, setSystemSetting } = await import('./system-settings')
const { getSiteSettings, updateSiteSettings } = await import('./site-settings')
const { DEFAULT_SITE_SETTINGS } = await import('../site-settings')
const migrationName = '20261015000000_add_system_settings'
const migrationsRoot = path.resolve('prisma/migrations')
const migrationSql = readFileSync(path.join(migrationsRoot, migrationName, 'migration.sql'), 'utf8')

function migrate(schema: string, url: string) {
  if (!existsSync(url.slice(5))) writeFileSync(url.slice(5), '')
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 30_000,
  })
}

beforeAll(() => { migrate(path.resolve('prisma/schema.prisma'), databaseUrl) }, 60_000)
beforeEach(async () => {
  // 独立临时库，绝不修改开发者数据库。
  await prisma.$transaction([
    prisma.favorite.deleteMany(), prisma.playlistEntry.deleteMany(), prisma.playlistAllowedUser.deleteMany(),
    prisma.playlist.deleteMany(), prisma.playHistory.deleteMany(), prisma.user.deleteMany(),
    prisma.musicInfo.deleteMany(), prisma.audioCache.deleteMany(), prisma.recommendTask.deleteMany(),
    prisma.systemSetting.deleteMany(),
  ])
  const seed = migrationSql.slice(migrationSql.indexOf('INSERT INTO'))
  await prisma.$executeRawUnsafe(seed)
})
afterAll(async () => {
  await prisma.$disconnect()
  vi.unstubAllEnvs()
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('真实 SQLite 初始化与设置', () => {
  it('站点设置缺省无需落库，保存后新连接仍可读取，并支持空简介与恢复默认', async () => {
    expect(await getSiteSettings()).toEqual(DEFAULT_SITE_SETTINGS)
    expect(await prisma.systemSetting.count({ where: { key: { startsWith: 'site.' } } })).toBe(0)
    await updateSiteSettings({ name: ' 我的音乐 ', description: '' })
    const anotherConnection = new PrismaClient({ datasourceUrl: databaseUrl })
    try { expect(await getSiteSettings(anotherConnection)).toEqual({ name: '我的音乐', description: '' }) }
    finally { await anotherConnection.$disconnect() }
    await updateSiteSettings(DEFAULT_SITE_SETTINGS)
    expect(await getSiteSettings()).toEqual(DEFAULT_SITE_SETTINGS)
  })

  it('站点设置校验失败不写入，第二字段写入故障时回滚名称', async () => {
    await expect(updateSiteSettings({ name: '新名称', description: 123 })).rejects.toThrow()
    expect(await getSiteSettings()).toEqual(DEFAULT_SITE_SETTINGS)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_site BEFORE INSERT ON "SystemSetting" WHEN NEW.key = 'site.description' BEGIN SELECT RAISE(ABORT, 'test failure'); END`)
    try { await expect(updateSiteSettings({ name: '不应保存', description: '失败' })).rejects.toThrow() }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_site') }
    expect(await getSiteSettings()).toEqual(DEFAULT_SITE_SETTINGS)
  })

  it('历史实例仅有名称时保留该名称，损坏设置会报告错误而不返回任意内容', async () => {
    await setSystemSetting('site.name', '旧站点')
    expect(await getSiteSettings()).toEqual({ ...DEFAULT_SITE_SETTINGS, name: '旧站点' })
    await prisma.systemSetting.update({ where: { key: 'site.name' }, data: { valueJson: '123' } })
    await expect(getSiteSettings()).rejects.toThrow('设置项格式无效')
  })

  it('新库迁移即持久化待设置状态，重新连接后仍可继续', async () => {
    expect(await getInitializationStatus()).toMatchObject({ setupRequired: true, setupRecoveryRequired: false })
    const anotherConnection = new PrismaClient({ datasourceUrl: databaseUrl })
    try { expect(await getInitializationStatus(anotherConnection)).toMatchObject({ setupRequired: true }) }
    finally { await anotherConnection.$disconnect() }
  })

  it('创建管理员并关闭入口，保持密码及会话版本，重复设置无法覆盖', async () => {
    await completeInitialization('my-new-password')
    expect(await getInitializationStatus()).toMatchObject({ setupRequired: false })
    expect(await prisma.user.findUnique({ where: { username: 'admin' } })).toMatchObject({
      subsonicSecret: 'my-new-password', mustChangePassword: false, sessionVersion: 0,
    })
    await expect(completeInitialization('attacker-password')).rejects.toMatchObject({ statusCode: 409 })
    expect((await prisma.user.findUnique({ where: { username: 'admin' } }))?.subsonicSecret).toBe('my-new-password')
  })

  it('并发初始化只有一次成功，状态与账户一致', async () => {
    const results = await Promise.allSettled([
      completeInitialization('concurrent-first'), completeInitialization('concurrent-second'),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.user.count()).toBe(1)
    expect(await getSystemSetting('system.initialization')).toMatchObject({ status: 'completed', source: 'web' })
  })

  it('创建管理员失败时整体回滚，不留下已完成标记', async () => {
    await prisma.$executeRawUnsafe('CREATE TRIGGER reject_setup BEFORE INSERT ON "User" BEGIN SELECT RAISE(ABORT, \'test failure\'); END')
    try { await expect(completeInitialization('transaction-password')).rejects.toThrow() }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_setup') }
    expect(await prisma.user.count()).toBe(0)
    expect(await getInitializationStatus()).toMatchObject({ setupRequired: true })
  })

  it('已完成后删除管理员也不会重新开放初始化', async () => {
    await completeInitialization('initial-password')
    await prisma.user.deleteMany()
    expect(await getInitializationStatus()).toMatchObject({ setupRequired: false })
    await expect(completeInitialization('new-password')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('已有管理员或预置账户自动补记完成，不修改密码、改密标记及会话版本', async () => {
    const user = await prisma.user.create({ data: { username: 'admin', subsonicSecret: 'existing-password', mustChangePassword: true, sessionVersion: 7 } })
    expect(await getInitializationStatus()).toMatchObject({ setupRequired: false })
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toEqual(user)
  })

  it('历史用户或业务数据缺少管理员时关闭初始化，其他用户不受修改', async () => {
    const user = await prisma.user.create({ data: { username: 'alice', subsonicSecret: 'alice-secret' } })
    expect(await getInitializationStatus()).toMatchObject({ setupRequired: false, setupRecoveryRequired: true })
    await expect(completeInitialization('claim-admin-password')).rejects.toMatchObject({ statusCode: 409 })
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toEqual(user)
  })

  it('无账号但已有歌曲也不能被认领为新安装', async () => {
    await prisma.musicInfo.create({ data: { source: 'tx', songmid: '1', data: '{}', checksum: 'fixture' } })
    expect(await getInitializationStatus()).toMatchObject({ setupRequired: false, setupRecoveryRequired: true })
  })

  it('初始化记录丢失或损坏时拒绝开放入口', async () => {
    await prisma.systemSetting.deleteMany()
    await expect(getInitializationStatus()).rejects.toThrow('初始化记录缺失')
    await prisma.systemSetting.create({ data: { key: 'system.initialization', valueJson: '{invalid' } })
    await expect(getInitializationStatus()).rejects.toThrow('有效 JSON')
    await prisma.systemSetting.update({ where: { key: 'system.initialization' }, data: { valueJson: '{"status":"pending"}' } })
    await expect(getInitializationStatus()).rejects.toThrow('格式无效')
  })

  it('通用设置保留空数组语义，校验平台及类型，禁止重置初始化状态', async () => {
    expect(await getSystemSetting('music.enabledPlatforms')).toBeNull()
    await setSystemSetting('music.enabledPlatforms', [])
    expect(await getSystemSetting('music.enabledPlatforms')).toEqual([])
    await setSystemSetting('music.enabledPlatforms', ['tx', 'wy'])
    expect(await getSystemSetting('music.enabledPlatforms')).toEqual(['tx', 'wy'])
    await setSystemSetting('site.name', 'My Music')
    expect(await getSystemSetting('site.name')).toBe('My Music')
    // @ts-expect-error 验证运行期也不能绕过注册表
    await expect(setSystemSetting('music.enabledPlatforms', ['qq'])).rejects.toThrow('格式无效')
    await expect(setSystemSetting('music.enabledPlatforms', ['tx', 'tx'])).rejects.toThrow('格式无效')
    // @ts-expect-error 初始化状态不属于通用可编辑设置
    await expect(setSystemSetting('system.initialization', {})).rejects.toThrow('不能通过')
  })

  it('历史版本真实迁移保留管理员、普通用户、收藏、歌单及会话版本', async () => {
    const legacyRoot = path.join(fixtureRoot, 'legacy')
    mkdirSync(path.join(legacyRoot, 'migrations'), { recursive: true })
    const schema = path.join(legacyRoot, 'schema.prisma')
    const originalSchema = readFileSync(path.resolve('prisma/schema.prisma'), 'utf8')
    writeFileSync(schema, originalSchema.replace(/model SystemSetting \{[\s\S]*?\n\}/, ''))
    for (const name of readdirSync(migrationsRoot)) {
      if (name !== migrationName) cpSync(path.join(migrationsRoot, name), path.join(legacyRoot, 'migrations', name), { recursive: true })
    }
    const url = `file:${path.join(legacyRoot, 'old.db').replace(/\\/g, '/')}`
    migrate(schema, url)
    const oldDb = new PrismaClient({ datasourceUrl: url })
    try {
      await oldDb.user.create({ data: { username: 'admin', subsonicSecret: 'old-admin-password', sessionVersion: 4, mustChangePassword: true } })
      const alice = await oldDb.user.create({ data: { username: 'alice', subsonicSecret: 'old-alice-password', sessionVersion: 9 } })
      await oldDb.favorite.create({ data: { userId: alice.id, itemType: 'song', itemId: 'tx-1', source: 'tx' } })
      await oldDb.playlist.create({ data: { username: 'alice', name: '旧歌单', isPublic: false } })
      const snapshot = {
        users: await oldDb.user.findMany(), favorites: await oldDb.favorite.findMany(), playlists: await oldDb.playlist.findMany(),
      }
      cpSync(path.join(migrationsRoot, migrationName), path.join(legacyRoot, 'migrations', migrationName), { recursive: true })
      writeFileSync(schema, originalSchema)
      migrate(schema, url)
      expect(await getInitializationStatus(oldDb)).toMatchObject({ setupRequired: false })
      expect(await oldDb.user.findMany()).toEqual(snapshot.users)
      expect(await oldDb.favorite.findMany()).toEqual(snapshot.favorites)
      expect(await oldDb.playlist.findMany()).toEqual(snapshot.playlists)
      expect(await getSystemSetting('system.initialization', oldDb)).toMatchObject({ source: 'legacy', status: 'completed' })
    } finally { await oldDb.$disconnect() }
  }, 60_000)
})
