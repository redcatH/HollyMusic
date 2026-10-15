import type { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/db'
import { getSystemSetting, type InitializationSetting } from './system-settings'

const INITIALIZATION_KEY = 'system.initialization'
type InitializationDatabase = Pick<Prisma.TransactionClient, 'user' | 'systemSetting' | '$queryRaw'>

export interface InitializationStatus {
  setupRequired: boolean
  setupRecoveryRequired: boolean
  setupTokenRequired: boolean
}

export class SetupError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 409 | 503) {
    super(message)
  }
}

async function hasExistingData(db: InitializationDatabase): Promise<boolean> {
  const [row] = await db.$queryRaw<Array<{ present: number | bigint }>>`
    SELECT EXISTS(SELECT 1 FROM "User")
      OR EXISTS(SELECT 1 FROM "MusicInfo")
      OR EXISTS(SELECT 1 FROM "Favorite")
      OR EXISTS(SELECT 1 FROM "Playlist")
      OR EXISTS(SELECT 1 FROM "PlaylistEntry")
      OR EXISTS(SELECT 1 FROM "PlaylistAllowedUser")
      OR EXISTS(SELECT 1 FROM "PlayHistory")
      OR EXISTS(SELECT 1 FROM "AudioCache")
      OR EXISTS(SELECT 1 FROM "RecommendTask") AS present`
  return Boolean(row.present)
}

function completedSetting(source: InitializationSetting['source']): InitializationSetting {
  return { version: 1, status: 'completed', source, completedAt: new Date().toISOString() }
}

/** 缺失或损坏的记录绝不自动当作新安装；预置用户与旧版本回滚后创建的管理员自动兼容。 */
export async function getInitializationStatus(db: InitializationDatabase = prisma): Promise<InitializationStatus> {
  const setting = await getSystemSetting(INITIALIZATION_KEY, db)
  if (setting?.status === 'completed') {
    return { setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false }
  }

  const admin = await db.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
  if (admin) {
    const valueJson = JSON.stringify(completedSetting(setting?.source === 'new' ? 'config' : 'legacy'))
    await db.systemSetting.upsert({
      where: { key: INITIALIZATION_KEY },
      create: { key: INITIALIZATION_KEY, valueJson },
      update: { valueJson },
    })
    return { setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false }
  }

  if (!setting) throw new SetupError('初始化记录缺失，请检查数据库迁移或恢复备份', 503)
  let recovery = setting.status === 'recovery'
  if (!recovery && await hasExistingData(db)) {
    recovery = true
    await db.systemSetting.updateMany({
      where: { key: INITIALIZATION_KEY, valueJson: JSON.stringify(setting) },
      data: { valueJson: JSON.stringify({ ...setting, status: 'recovery' }) },
    })
  }
  return {
    setupRequired: !recovery,
    setupRecoveryRequired: recovery,
    setupTokenRequired: !recovery && Boolean(process.env.SETUP_TOKEN),
  }
}

export function validateInitialPassword(password: unknown, confirmation: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new SetupError('密码长度需为 8–128 位', 400)
  }
  if (password !== confirmation) throw new SetupError('两次输入的密码不一致', 400)
  if (!password.trim()) throw new SetupError('密码不能全部为空白字符', 400)
}

/** 先原子认领状态，再创建管理员；任一步失败均整体回滚。 */
export async function completeInitialization(password: string): Promise<{ username: string; sessionVersion: number }> {
  try {
    return await prisma.$transaction(async tx => {
      const setting = await getSystemSetting(INITIALIZATION_KEY, tx)
      if (setting?.status !== 'pending' || await hasExistingData(tx)) {
        throw new SetupError('此实例已初始化或需要管理员恢复，请刷新页面', 409)
      }
      const claimed = await tx.systemSetting.updateMany({
        where: { key: INITIALIZATION_KEY, valueJson: JSON.stringify(setting) },
        data: { valueJson: JSON.stringify(completedSetting('web')) },
      })
      if (claimed.count !== 1) throw new SetupError('初始化已由其他页面完成，请刷新页面', 409)
      return tx.user.create({
        data: { username: 'admin', subsonicSecret: password, mustChangePassword: false },
        select: { username: true, sessionVersion: true },
      })
    }, { timeout: 10_000 })
  } catch (error) {
    if (error instanceof SetupError) throw error
    const code = (error as { code?: string }).code
    if (code && ['P2002', 'P2028', 'P2034', 'P1008'].includes(code)) {
      throw new SetupError('初始化正在其他页面进行，请稍后刷新页面', 409)
    }
    throw error
  }
}
