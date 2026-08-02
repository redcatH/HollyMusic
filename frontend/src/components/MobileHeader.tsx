import { useLocation } from 'react-router-dom'
import { Menu, Music2 } from 'lucide-react'

const TITLES: Array<{ match: string; title: string }> = [
  { match: '/admin/users', title: '用户管理' },
  { match: '/playlists/', title: '歌单详情' },
  { match: '/playlists', title: '我的歌单' },
  { match: '/favorites', title: '我的收藏' },
  { match: '/history', title: '播放历史' },
  { match: '/search', title: '搜索' },
  { match: '/', title: '发现音乐' },
]

function getTitle(pathname: string): string {
  for (const t of TITLES) {
    if (t.match === pathname) return t.title
  }
  for (const t of TITLES) {
    if (t.match !== '/' && pathname.startsWith(t.match)) return t.title
  }
  return 'Holly Music'
}

export function MobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const { pathname } = useLocation()
  const title = getTitle(pathname)

  return (
    <header className="safe-area-top flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-2 backdrop-blur-md md:hidden">
      <button
        onClick={onMenuClick}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-accent"
        aria-label="打开菜单"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 items-center gap-2">
        <Music2 className="h-5 w-5 shrink-0 text-primary" />
        <span className="truncate text-base font-semibold">{title}</span>
      </div>
    </header>
  )
}
