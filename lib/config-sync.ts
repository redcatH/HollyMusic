import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import crypto from 'crypto'
import { PrismaClient } from './generated/prisma'
import { logger } from '@/lib/logger'

const prisma = new PrismaClient()

export type UserConfigEntry = { username: string; password: string }

export type SyncUsersResult = {
  imported: number
  created: string[]
}

export type InitialAdminResult = {
  created: boolean
  username: 'admin'
}

/**
 * 生成 16 位随机密码（字母+数字，易抄写）。
 * 用于首次初始化的 admin 账户，避免默认 admin/admin 弱口令。
 */
function generateRandomPassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(length)
  let pwd = ''
  for (let i = 0; i < length; i++) {
    pwd += chars[bytes[i] % chars.length]
  }
  return pwd
}

/**
 * 导入运维者显式提供的用户配置。
 *
 * 不在这里生成默认管理员，也不把随机密码写入 config/users.json：
 * 首次管理员引导由 ensureInitialAdmin() 单独处理，避免把密码持久化到配置卷。
 */
export async function syncUsersFromConfig(configPath?: string): Promise<SyncUsersResult> {
  // next build（SSG/prerender）期间不执行，避免构建过程导入用户配置、
  // 触发弱口令迁移等运行时副作用。Docker 运行期由 instrumentation.ts 调用。
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return { imported: 0, created: [] as string[] }
  }
  try {
    const p = resolve(process.cwd(), configPath || process.env.USER_CONFIG_PATH || 'config/users.json')
    if (!existsSync(p)) {
      logger.info(`[config-sync] 未找到用户配置，跳过导入: ${p}`)
      return { imported: 0, created: [] }
    }

    const raw = readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    const users: UserConfigEntry[] = Array.isArray(parsed) ? parsed : parsed.users || []
    const created: string[] = []
    const seenUsernames = new Set<string>()

    for (const u of users) {
      if (!u || !u.username) continue
      const username = String(u.username).trim()
      if (!username) continue
      if (seenUsernames.has(username)) {
        throw new Error(`用户配置中存在重复用户名: ${username}`)
      }
      seenUsernames.add(username)

      if (typeof u.password !== 'string' || !u.password) {
        throw new Error(`用户配置中 ${username} 的密码不能为空`)
      }
      const password = u.password

      const existing = await prisma.user.findUnique({ where: { username } })
      if (!existing) {
        // 首次创建：以 config/users.json 为准。
        // 但若配置里是弱口令 'admin'（仓库默认值），改用随机密码，避免弱口令进 DB。
        // admin 账户强制要求首次登录改密（随机初始密码 / 默认 admin/admin 场景）。
        let effectivePassword = password
        if (username === 'admin' && password === 'admin') {
          effectivePassword = generateRandomPassword()
          logInitialAdminPassword('[config-sync] config/users.json 中 admin 密码为默认弱口令，已改用随机密码', effectivePassword)
        }
        const mustChange = username === 'admin'
        await prisma.user.create({
          data: { username, subsonicSecret: effectivePassword, mustChangePassword: mustChange },
        })
        created.push(username)
      }
      // 已存在用户：密码以 DB 为准，不再被配置文件覆盖。
      // 这样用户通过 Web UI 改密后，重启容器不会把密码回写回 config 里的旧值，
      // 也就不会反复触发下方的弱口令迁移导致 mustChangePassword 被反复置 true。
    }

    // 迁移历史弱口令：仍使用 admin/admin 的账户，重置为随机密码并强制改密
    try {
      const weakUsers = await prisma.user.findMany({ where: { subsonicSecret: 'admin' } })
      for (const wu of weakUsers) {
        const newPwd = generateRandomPassword()
        await prisma.user.update({
          where: { id: wu.id },
          data: { subsonicSecret: newPwd, mustChangePassword: true, sessionVersion: { increment: 1 } },
        })
        logInitialAdminPassword(`[config-sync] 检测到弱口令账户 "${wu.username}"（原密码为 admin），已重置为随机密码`, newPwd)
      }
    } catch (e) {
      logger.warn(`[config-sync] 弱口令迁移失败（非致命）: ${formatError(e)}`)
    }

    const total = created.length
    logger.info(`[config-sync] 用户导入完成: created=${created.length} total=${total}`)
    if (created.length) logger.info(`[config-sync] 已创建用户: ${created.join(', ')}`)
    return { imported: total, created }
  } catch (err) {
    logger.error(`[config-sync] 用户导入失败: ${formatError(err)}`)
    throw err
  }
}

/**
 * 没有任何管理员时创建随机 admin。
 * 密码只写入数据库并输出一次启动日志，绝不写入 config/users.json 或镜像层。
 */
export async function ensureInitialAdmin(): Promise<InitialAdminResult> {
  const existing = await prisma.user.findUnique({ where: { username: 'admin' } })
  if (existing) return { created: false, username: 'admin' }

  const password = generateRandomPassword()
  try {
    await prisma.user.create({
      data: { username: 'admin', subsonicSecret: password, mustChangePassword: true },
    })
  } catch (err) {
    // 多实例同时首启时，另一个实例可能已抢先创建 admin；此时不重复打印密码。
    const concurrentAdmin = await prisma.user.findUnique({ where: { username: 'admin' } })
    if (concurrentAdmin) return { created: false, username: 'admin' }
    logger.error(`[config-sync] 创建初始管理员失败: ${formatError(err)}`)
    throw err
  }

  logInitialAdminPassword('[config-sync] 已创建默认管理员账户，用户名: admin', password)
  return { created: true, username: 'admin' }
}

function logInitialAdminPassword(message: string, password: string): void {
  logger.info('========================================================')
  logger.info(message)
  logger.info(`[config-sync] 随机初始密码: ${password}`)
  logger.info('[config-sync] 请立即登录并修改密码！此密码仅显示一次。')
  logger.info('========================================================')
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const configSyncApi = { syncUsersFromConfig, ensureInitialAdmin }
export default configSyncApi
