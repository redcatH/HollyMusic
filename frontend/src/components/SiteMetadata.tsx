import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useSiteSettingsStore } from '@/lib/store/site-settings-store'

export function getPageName(pathname: string): string | null {
  if (pathname === '/') return null
  const routes: Array<[string, string]> = [
    ['/login', '登录'], ['/setup', '首次设置'], ['/change-password', '修改密码'],
    ['/admin/users', '用户管理'], ['/admin/sources', '音源管理'], ['/admin/recommend', '推荐管理'],
    ['/admin', '系统管理'], ['/equalizer', '声音设置'], ['/offline', '本地歌曲'],
    ['/discover/toplists/', '排行榜'], ['/discover/playlists/', '歌单详情'],
    ['/playlists/ai-create', 'AI 建歌单'], ['/playlists/', '歌单详情'],
    ['/playlists', '我的歌单'], ['/favorites', '我的收藏'], ['/history', '播放历史'],
    ['/search', '搜索'], ['/recommend', '推荐'],
  ]
  return routes.find(([path]) => pathname === path || pathname.startsWith(path.endsWith('/') ? path : `${path}/`))?.[1] ?? null
}

/** React 19 原生 head 元素，涵盖登录、初始化、离线和主布局。 */
export function SiteMetadata() {
  const { pathname } = useLocation()
  const settings = useSiteSettingsStore(s => s.settings)
  const refresh = useSiteSettingsStore(s => s.refresh)
  useEffect(() => {
    void refresh()
    const reconnect = () => { void refresh() }
    window.addEventListener('online', reconnect)
    return () => window.removeEventListener('online', reconnect)
  }, [refresh])
  const pageName = getPageName(pathname)
  return <>
    <title>{pageName ? `${pageName} · ${settings.name}` : settings.name}</title>
    <meta name="description" content={settings.description} />
    <meta name="apple-mobile-web-app-title" content={settings.name} />
    <link rel="manifest" href={`/manifest.json?name=${encodeURIComponent(settings.name)}&description=${encodeURIComponent(settings.description)}`} />
  </>
}
