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
    const updated: string[] = []
    for (const u of users) {
      if (!u || !u.username) continue
      const username = String(u.username).trim()
      const password = u.password ?? ''
      if (!username) continue

      const existing = await prisma.user.findUnique({ where: { username } })
      if (!existing) {
        // 新建用户：admin 账户强制要求首次登录改密（随机初始密码场景）
        const mustChange = username === 'admin'
        await prisma.user.create({
          data: { username, subsonicSecret: password, mustChangePassword: mustChange },
        })
        created.push(username)
      } else {
        // 已存在用户：密码变更才更新
        if ((existing.subsonicSecret ?? '') !== password) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { subsonicSecret: password },
          })
          updated.push(username)
        }
      }
    }

    // 迁移历史弱口令：仍使用 admin/admin 的账户，重置为随机密码并强制改密
    try {
      const weakUsers = await prisma.user.findMany({ where: { subsonicSecret: 'admin' } })
      for (const wu of weakUsers) {
        const newPwd = generateRandomPassword()
        await prisma.user.update({
          where: { id: wu.id },
          data: { subsonicSecret: newPwd, mustChangePassword: true },
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

    const total = created.length + updated.length
    console.info('[config-sync] synced users: created=%d updated=%d total=%d', created.length, updated.length, total)
    if (created.length) console.info('[config-sync] created:', created.join(', '))
    if (updated.length) console.info('[config-sync] updated:', updated.join(', '))
    return { imported: total, created, updated }
  } catch (err) {
    console.error('[config-sync] error', err)
    return { imported: 0, created: [], updated: [], error: err }
  }
}

const configSyncApi = { syncUsersFromConfig }
export default configSyncApi
