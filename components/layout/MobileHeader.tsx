'use client'

import { usePathname } from 'next/navigation'
import { Menu, Music2 } from 'lucide-react'

/** 路径 → 页面标题映射（动态路由用 startsWith 兜底） */
const TITLES: Array<{ match: string; title: string }> = [
  { match: '/admin/users', title: '用户管理' },
  { match: '/playlists/', title: '歌单详情' },
  { match: '/playlists', title: '我的歌单' },
  { match: '/favorites', title: '我的收藏' },
  { match: '/history', title: '播放历史' },
  { match: '/search', title: '搜索' },
  { match: '/', title: '发现音乐' },
]

function getTitle(pathname: string | null): string {
  if (!pathname) return 'Holly Music'
  // 精确匹配优先，其次前缀匹配
  for (const t of TITLES) {
    if (t.match === pathname) return t.title
  }
  for (const t of TITLES) {
    if (t.match !== '/' && pathname.startsWith(t.match)) return t.title
  }
  return 'Holly Music'
}

interface Props {
  onMenuClick: () => void
}

/**
 * 小屏顶部导航栏（<768px 显示）
 *
 * 替代原悬浮汉堡按钮：作为 flex-col 第一个子元素自然占位，
 * 内容区下移让位，不遮挡任何页面内容。
 * - 左：汉堡按钮（44×44 触摸友好）
 * - 中：logo + 当前页面标题
 * - 毛玻璃 sticky 背景，滚动时不脱离视野
 */
export function MobileHeader({ onMenuClick }: Props) {
  const pathname = usePathname()
  const title = getTitle(pathname)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-2 backdrop-blur-md md:hidden">
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
