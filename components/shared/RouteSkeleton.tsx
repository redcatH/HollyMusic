/**
 * 按路由渲染对应的骨架屏，让 pending 期间的骨架贴合真实页面布局。
 *
 * 用于 AppShell main 区域的导航 pending 状态：
 * pendingPath 决定显示哪个骨架，pathname 更新后骨架消失。
 */

/** SongRow 样式骨架（序号 + 封面 + 歌名/歌手 + 时长），复用于搜索/收藏/历史 */
function SongListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md px-2 py-2">
          <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
          <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-2 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

/** 首页骨架：标题行 + 按钮 + 网格卡片（aspect-square 封面 + 歌名 + 歌手） */
function HomeSkeleton() {
  return (
    <div className="p-6">
      {/* 标题 + 按钮行 */}
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-32 animate-pulse rounded bg-muted" />
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 animate-pulse rounded-full bg-muted" />
          <div className="h-9 w-20 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
      {/* 网格卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg p-2">
            <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 搜索骨架：标题 + 搜索框 + 源选择 + 列表 */
function SearchSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-4 h-7 w-20 animate-pulse rounded bg-muted" />
      {/* 搜索框 + 选择器 */}
      <div className="mb-6 flex gap-2">
        <div className="h-10 flex-1 animate-pulse rounded-full bg-muted" />
        <div className="h-10 w-20 animate-pulse rounded-full bg-muted" />
      </div>
      <SongListSkeleton />
    </div>
  )
}

/** 收藏骨架：标题 + 列表 */
function FavoritesSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-4 h-7 w-28 animate-pulse rounded bg-muted" />
      <SongListSkeleton />
    </div>
  )
}

/** 歌单骨架：标题 + 新建按钮 + 网格卡片 */
function PlaylistsSkeleton() {
  return (
    <div className="p-6">
      {/* 标题 + 新建按钮 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="h-7 w-24 animate-pulse rounded bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded-full bg-muted" />
      </div>
      {/* 网格卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg p-2">
            <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 历史骨架：标题 + 清空按钮 + 列表 */
function HistorySkeleton() {
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-7 w-24 animate-pulse rounded bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded-full bg-muted" />
      </div>
      <SongListSkeleton />
    </div>
  )
}

/** 通用骨架（未知路由兜底） */
function GenericSkeleton() {
  return (
    <div className="p-6">
      <div className="mb-4 h-7 w-32 animate-pulse rounded bg-muted" />
      <SongListSkeleton />
    </div>
  )
}

/** 按路径匹配骨架组件 */
export function RouteSkeleton({ path }: { path: string }) {
  if (path === '/') return <HomeSkeleton />
  if (path === '/search') return <SearchSkeleton />
  if (path === '/favorites') return <FavoritesSkeleton />
  if (path === '/playlists') return <PlaylistsSkeleton />
  if (path === '/history') return <HistorySkeleton />
  return <GenericSkeleton />
}
