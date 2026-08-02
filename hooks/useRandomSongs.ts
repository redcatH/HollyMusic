
import { useEffect } from 'react'
import { useDiscoverStore } from '@/lib/store/discover-store'

/**
 * 发现音乐（随机推荐）hook
 *
 * 数据存放在 discover-store（组件外部），组件卸载不丢数据。
 * 组件挂载时调用 fetch(force=false)：有未过期缓存则不请求，
 * 过期或首次才拉取。「换一批」按钮用 reload（force=true）。
 */
export function useRandomSongs(size = 30) {
  const songs = useDiscoverStore(s => s.songs)
  const loading = useDiscoverStore(s => s.loading)
  const error = useDiscoverStore(s => s.error)
  const fetchSongs = useDiscoverStore(s => s.fetch)
  const reloadStore = useDiscoverStore(s => s.reload)

  useEffect(() => {
    // force=false：命中未过期缓存时不会发请求
    fetchSongs(size, false)
  }, [size, fetchSongs])

  // reload 透传 force=true
  const reload = () => reloadStore(size)

  return { songs, loading, error, reload }
}
