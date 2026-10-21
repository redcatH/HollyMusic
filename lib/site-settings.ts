/** 浏览器与服务端共享的公开站点设置；不包含部署或账号信息。 */
export interface SiteSettings {
  name: string
  description: string
}

export const DEFAULT_SITE_SETTINGS: Readonly<SiteSettings> = Object.freeze({
  name: 'Holly Music',
  description: '把时间交给音乐',
})
export const SITE_NAME_MAX_LENGTH = 100
export const SITE_DESCRIPTION_MAX_LENGTH = 200
export const PROJECT_URL = 'https://github.com/redcatH/HollyMusic'

export class SiteSettingsError extends Error {}

function validateText(value: unknown, label: string, maxLength: number, required: boolean): string {
  if (typeof value !== 'string') throw new SiteSettingsError(`${label}必须是文本`)
  const text = value.trim()
  if (required && !text) throw new SiteSettingsError(`请填写${label}`)
  if (text.length > maxLength) throw new SiteSettingsError(`${label}不能超过 ${maxLength} 个字符`)
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(text)) throw new SiteSettingsError(`${label}不能包含控制字符或换行`)
  return text
}

/** 返回新的白名单对象，避免把 API 或本地缓存中的其他字段带入展示层。 */
export function parseSiteSettings(value: unknown): SiteSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SiteSettingsError('站点设置格式无效')
  const record = value as Record<string, unknown>
  return {
    name: validateText(record.name, '站点名称', SITE_NAME_MAX_LENGTH, true),
    description: validateText(record.description, '站点简介', SITE_DESCRIPTION_MAX_LENGTH, false),
  }
}
