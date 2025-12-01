import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from './generated/prisma'

const prisma = new PrismaClient()

export type UserConfigEntry = { username: string; password: string }

export async function syncUsersFromConfig(configPath?: string) {
  try {
    const p = resolve(process.cwd(), configPath || process.env.USER_CONFIG_PATH || 'config/users.json')
    // 如果配置文件不存在，则创建默认配置文件（admin/admin）
    if (!existsSync(p)) {
      // 确保目录存在
      const dir = resolve(process.cwd(), 'config')
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      } catch {
        console.warn('[config-sync] failed to create config directory', dir)
      }
      const defaultUsers = { users: [{ username: 'admin', password: 'admin' }] }
      try {
        writeFileSync(p, JSON.stringify(defaultUsers, null, 2), { encoding: 'utf8' })
        console.info('[config-sync] created default user config at', p)
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
        await prisma.user.create({ data: { username, subsonicSecret: password } })
        created.push(username)
      } else {
        // if password differs, update; otherwise skip
        if ((existing.subsonicSecret ?? '') !== password) {
          await prisma.user.update({ where: { id: existing.id }, data: { subsonicSecret: password } })
          updated.push(username)
        }
      }
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
