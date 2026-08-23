import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import crypto from 'crypto'
import { PrismaClient } from './generated/prisma'

const prisma = new PrismaClient()

export type UserConfigEntry = { username: string; password: string }

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

export async function syncUsersFromConfig(configPath?: string) {
  // next build（SSG/prerender）期间不执行：此时生成 users.json 会写入构建容器，
  // 随 Dockerfile 的 COPY config/ 打进镜像分发，且初始密码打印在公开的构建日志中。
  // 运行时（含用户挂载的 config 卷）首次启动会自行生成并打印在用户自己的日志里。
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return { imported: 0, created: [] as string[] }
  }
  try {
    const p = resolve(process.cwd(), configPath || process.env.USER_CONFIG_PATH || 'config/users.json')
    // 如果配置文件不存在，则创建默认配置文件（admin + 随机密码）
    if (!existsSync(p)) {
      // 确保目录存在
      const dir = resolve(process.cwd(), 'config')
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      } catch {
        console.warn('[config-sync] failed to create config directory', dir)
      }
      const randomPassword = generateRandomPassword()
      const defaultUsers = { users: [{ username: 'admin', password: randomPassword }] }
      try {
        writeFileSync(p, JSON.stringify(defaultUsers, null, 2), { encoding: 'utf8' })
        // 随机初始密码打印到日志（仅此一次），部署者据此首次登录后应立即改密
        console.info('========================================================')
        console.info('[config-sync] 已创建默认管理员账户，用户名: admin')
        console.info(`[config-sync] 随机初始密码: ${randomPassword}`)
        console.info('[config-sync] 请立即登录并修改密码！此密码仅显示一次。')
        console.info('========================================================')
      } catch {
        console.error('[config-sync] failed to write default config at', p)
      }
    }

    let raw: string
    try {
      raw = readFileSync(p, 'utf8')
    } catch {
      console.info('[config-sync] user config not readable at', p)
      return { imported: 0 }
    }

    const parsed = JSON.parse(raw)
    const users: UserConfigEntry[] = Array.isArray(parsed) ? parsed : parsed.users || []
    const created: string[] = []
    for (const u of users) {
      if (!u || !u.username) continue
      const username = String(u.username).trim()
      const password = u.password ?? ''
      if (!username) continue

      const existing = await prisma.user.findUnique({ where: { username } })
      if (!existing) {
        // 首次创建：以 config/users.json 为准。
        // 但若配置里是弱口令 'admin'（仓库默认值），改用随机密码，避免弱口令进 DB。
        // admin 账户强制要求首次登录改密（随机初始密码 / 默认 admin/admin 场景）。
        let effectivePassword = password
        if (username === 'admin' && password === 'admin') {
          effectivePassword = generateRandomPassword()
          console.warn('========================================================')
          console.warn('[config-sync] config/users.json 中 admin 密码为默认弱口令，已改用随机密码')
          console.warn(`[config-sync] 随机初始密码: ${effectivePassword}`)
          console.warn('[config-sync] 请立即登录并修改密码！此密码仅显示一次。')
          console.warn('========================================================')
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
        console.warn('========================================================')
        console.warn(`[config-sync] 检测到弱口令账户 "${wu.username}"（原密码为 admin），已重置为随机密码`)
        console.warn(`[config-sync] 新密码: ${newPwd}`)
        console.warn('[config-sync] 请立即登录并修改密码！此密码仅显示一次。')
        console.warn('========================================================')
      }
    } catch (e) {
      console.warn('[config-sync] 弱口令迁移失败（非致命）:', e)
    }

    const total = created.length
    console.info('[config-sync] synced users: created=%d total=%d', created.length, total)
    if (created.length) console.info('[config-sync] created:', created.join(', '))
    return { imported: total, created }
  } catch (err) {
    console.error('[config-sync] error', err)
    return { imported: 0, created: [], error: err }
  }
}

const configSyncApi = { syncUsersFromConfig }
export default configSyncApi
