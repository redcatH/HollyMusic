import type { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/db'
import { DEFAULT_SITE_SETTINGS, parseSiteSettings } from '@/lib/site-settings'

export interface InitializationSetting {
  version: 1
  status: 'pending' | 'completed' | 'recovery'
  source: 'new' | 'legacy' | 'config' | 'web'
  completedAt: string | null
}

export interface SystemSettingValues {
  'system.initialization': InitializationSetting
  'music.enabledPlatforms': Array<'tx' | 'wy' | 'kw' | 'kg' | 'mg'>
  'site.name': string
  'site.description': string
}

export type SettingDatabase = Pick<Prisma.TransactionClient, 'systemSetting'>
type EditableSettingKey = Exclude<keyof SystemSettingValues, 'system.initialization'>
const PLATFORMS = ['tx', 'wy', 'kw', 'kg', 'mg'] as const

export class SystemSettingError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 所有持久化设置均需注册并校验，不能通过泛型断言绕过运行期校验。 */
function validateSetting<K extends keyof SystemSettingValues>(key: K, value: unknown): SystemSettingValues[K] {
  let valid = false
  switch (key) {
    case 'system.initialization':
      valid = isRecord(value) && value.version === 1 &&
        ['pending', 'completed', 'recovery'].includes(String(value.status)) &&
        ['new', 'legacy', 'config', 'web'].includes(String(value.source)) &&
        (value.status === 'completed'
          ? typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt))
          : value.completedAt === null)
      break
    case 'music.enabledPlatforms':
      valid = Array.isArray(value) && new Set(value).size === value.length &&
        value.every(platform => PLATFORMS.some(known => known === platform))
      break
    case 'site.name':
    case 'site.description':
      try {
        const field = key === 'site.name' ? 'name' : 'description'
        const settings = parseSiteSettings({ ...DEFAULT_SITE_SETTINGS, [field]: value })
        return settings[field] as SystemSettingValues[K]
      } catch { throw new SystemSettingError(`设置项格式无效: ${key}`) }
  }
  if (!valid) throw new SystemSettingError(`设置项格式无效: ${key}`)
  return value as SystemSettingValues[K]
}

export async function getSystemSetting<K extends keyof SystemSettingValues>(
  key: K,
  db: SettingDatabase = prisma,
): Promise<SystemSettingValues[K] | null> {
  const row = await db.systemSetting.findUnique({ where: { key } })
  if (!row) return null
  let value: unknown
  try {
    value = JSON.parse(row.valueJson)
  } catch {
    throw new SystemSettingError(`设置项不是有效 JSON: ${key}`)
  }
  return validateSetting(key, value)
}

/** 仅允许写入已注册的普通设置；初始化状态由专用事务维护。 */
export async function setSystemSetting<K extends EditableSettingKey>(
  key: K,
  value: SystemSettingValues[K],
  db: SettingDatabase = prisma,
): Promise<void> {
  if (key !== 'music.enabledPlatforms' && key !== 'site.name' && key !== 'site.description') {
    throw new SystemSettingError('该设置项不能通过通用设置服务修改')
  }
  const valueJson = JSON.stringify(validateSetting(key, value))
  await db.systemSetting.upsert({ where: { key }, create: { key, valueJson }, update: { valueJson } })
}
