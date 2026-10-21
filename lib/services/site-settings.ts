import type { PrismaClient } from '@/lib/generated/prisma'
import { prisma } from '@/lib/db'
import { DEFAULT_SITE_SETTINGS, parseSiteSettings, type SiteSettings } from '@/lib/site-settings'
import { getSystemSetting, setSystemSetting } from './system-settings'

/** 同一快照读取两个字段；旧实例无需写入默认值或执行额外迁移。 */
export async function getSiteSettings(db: PrismaClient = prisma): Promise<SiteSettings> {
  return db.$transaction(async tx => {
    const name = await getSystemSetting('site.name', tx)
    const description = await getSystemSetting('site.description', tx)
    return parseSiteSettings({
      name: name ?? DEFAULT_SITE_SETTINGS.name,
      description: description ?? DEFAULT_SITE_SETTINGS.description,
    })
  })
}

export async function updateSiteSettings(value: unknown, db: PrismaClient = prisma): Promise<SiteSettings> {
  const settings = parseSiteSettings(value)
  await db.$transaction(async tx => {
    await setSystemSetting('site.name', settings.name, tx)
    await setSystemSetting('site.description', settings.description, tx)
  })
  return settings
}
