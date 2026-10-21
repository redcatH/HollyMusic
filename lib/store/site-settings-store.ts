import { create } from 'zustand'
import { fetchSiteSettings } from '@/lib/api/site-settings'
import { logger } from '@/lib/logger'
import { DEFAULT_SITE_SETTINGS, parseSiteSettings, type SiteSettings } from '@/lib/site-settings'

const CACHE_KEY = 'holly.site-settings.v1'

function cachedSettings(): SiteSettings {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) return parseSiteSettings(JSON.parse(cached))
  } catch { /* 离线首次启动、损坏或禁用存储均使用默认品牌。 */ }
  return { ...DEFAULT_SITE_SETTINGS }
}

interface SiteSettingsState {
  settings: SiteSettings
  refresh: () => Promise<void>
  apply: (settings: SiteSettings) => void
}

let pending: Promise<void> | null = null
let revision = 0

/** 最近一次成功读取用于离线展示；后台读取失败不能阻塞登录或播放。 */
export const useSiteSettingsStore = create<SiteSettingsState>((set, get) => ({
  settings: cachedSettings(),
  apply: value => {
    const settings = parseSiteSettings(value)
    revision++
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(settings)) }
    catch { /* 配额或隐私模式不影响当前窗口生效。 */ }
    set({ settings })
  },
  refresh: () => {
    if (pending) return pending
    const startedAt = revision
    pending = fetchSiteSettings().then(settings => {
      // 管理员保存后，不允许先发出的公共读取把新值覆盖回去。
      if (revision === startedAt) get().apply(settings)
    }).catch(error => {
      logger.warn('[site-settings] 使用最近的站点设置:', error)
    }).finally(() => { pending = null })
    return pending
  },
}))
