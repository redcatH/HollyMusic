import { useEffect, useRef, useState } from 'react'
import { listFavorites, type FavoriteSong } from '@/lib/api/favorites'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Heart, AlertCircle } from 'lucide-react'
import { toTrack, type Track } from '@/lib/types/player'
import { toast } from '@/lib/toast'

/** 收藏页分页大小；与服务端单页上限（500）保持在其内 */
const PAGE_SIZE = 100

export function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteSong[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 手动重试计数：与 favVersion 一起作为重拉依赖 */
  const [retryTick, setRetryTick] = useState(0)
  /** 已加载深度：收藏变更触发刷新时按当前深度整体重拉，避免回退到第一页 */
  const loadedCountRef = useRef(0)

  // 订阅 favorites version：PlayerBar / SongRow 收藏/取消成功（DB 已提交）后自增，
  // 触发本页重新拉取列表，使收藏列表实时变更。
  const favVersion = useFavoritesStore(s => s.version)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const limit = Math.min(Math.max(PAGE_SIZE, loadedCountRef.current), 500)
    listFavorites(limit, 0)
      .then(({ list, total }) => {
        if (cancelled) return
        setFavorites(list)
        setTotal(total)
        loadedCountRef.current = list.length
      })
      .catch(() => {
        // 失败时明确展示错误态，而不是把故障伪装成"还没有收藏"
        if (!cancelled) setError('收藏列表加载失败，请检查网络后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [favVersion, retryTick])

  const hasMore = favorites.length < total

  const loadMore = () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    listFavorites(PAGE_SIZE, favorites.length)
      .then(({ list, total }) => {
        setFavorites(prev => {
          // 按 songId 去重合并：翻页窗口内取消收藏可能造成边界重复
          const seen = new Set(prev.map(f => f.songId))
          const merged = [...prev, ...list.filter(f => !seen.has(f.songId))]
          loadedCountRef.current = merged.length
          return merged
        })
        setTotal(total)
      })
      .catch(() => {
        toast.error('加载更多失败，请重试')
      })
      .finally(() => setLoadingMore(false))
  }

  const tracks: Track[] = favorites
    .filter(f => f.musicInfo)
    .map(f => toTrack({ uid: f.songId, musicInfo: f.musicInfo! }))

  return (
    <div className="p-6">
      <h1 className="mb-4 hidden text-2xl font-bold md:block">我的收藏</h1>
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/60" />
          <div className="text-base font-medium text-muted-foreground">{error}</div>
          <button
            onClick={() => setRetryTick(t => t + 1)}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            重试
          </button>
        </div>
      ) : tracks.length > 0 ? (
        <>
          <SongList tracks={tracks} />
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-md border border-border bg-card px-6 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMore ? '加载中…' : `加载更多（${favorites.length}/${total}）`}
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState icon={Heart} title="还没有收藏" description="点击歌曲旁的心形图标收藏" />
      )}
    </div>
  )
}
