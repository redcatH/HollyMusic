import { parseSiteSettings, type SiteSettings } from '@/lib/site-settings'
import type { ApiResponse } from '@/lib/types/music'

async function requestSettings(admin: boolean, settings?: SiteSettings): Promise<SiteSettings> {
  const response = await fetch(admin ? '/api/admin/site-settings' : '/api/site/settings', {
    method: settings ? 'PUT' : 'GET',
    ...(settings ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  const result: ApiResponse<unknown> = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error?.message || '获取站点设置失败')
  return parseSiteSettings(result.data)
}

export function fetchSiteSettings(): Promise<SiteSettings> { return requestSettings(false) }
export function fetchAdminSiteSettings(): Promise<SiteSettings> { return requestSettings(true) }
export function saveSiteSettings(settings: SiteSettings): Promise<SiteSettings> {
  return requestSettings(true, parseSiteSettings(settings))
}
