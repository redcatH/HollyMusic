import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDebounce } from 'react-use'
import { ChevronLeft, ChevronRight, ListMusic, Music, Play, RefreshCw, Search, Trophy } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { RemoteCoverImage } from '@/components/shared/RemoteCoverImage'
import { getRecommendedPlaylists, getToplists } from '@/lib/api/discovery'
import type { DiscoveryPlaylist, DiscoveryPlaylistSort, DiscoverySource, DiscoveryToplist } from '@/lib/services/discovery-service'

const CHANNELS: Array<{ source: DiscoverySource; label: string }> = [
  { source: 'tx', label: 'QQ 音乐' },
  { source: 'wy', label: '网易云' },
  { source: 'kw', label: '酷我音乐' },
  { source: 'kg', label: '酷狗音乐' },
  { source: 'mg', label: '咪咕音乐' },
]

const PLAYLIST_PAGE_SIZE = 12
const PLAYLIST_CATEGORIES: Partial<Record<DiscoverySource, Array<{ id: string; name: string }>>> = {
  tx: [{ id: '', name: '全部分类' }, { id: '3317', name: '官方歌单' }, { id: '59', name: '经典老歌' }, { id: '71', name: '情歌' }, { id: '73', name: '游戏' }, { id: '3202', name: 'ACG' }],
  wy: [{ id: '', name: '全部分类' }, ...['华语', '欧美', '日语', '流行', '摇滚', '民谣', '电子', '轻音乐', '治愈'].map(name => ({ id: name, name }))],
  kw: [{ id: '', name: '全部分类' }, { id: '2189-10000', name: '短视频' }, { id: '1265-10000', name: '经典' }, { id: '2200-10000', name: '情歌' }, { id: '2199-10000', name: 'BGM' }, { id: '1877-10000', name: '游戏' }, { id: '155-10000', name: '怀旧' }],
  kg: [{ id: '', name: '全部分类' }, { id: '9', name: '流行' }, { id: '27', name: '摇滚' }, { id: '33', name: '电子' }, { id: '83', name: '民谣' }, { id: '780', name: '治愈' }, { id: '578', name: '伤感' }],
  mg: [{ id: '', name: '全部分类' }, { id: '1000001672', name: '流行' }, { id: '1000001674', name: '摇滚' }, { id: '1000001775', name: '民谣' }, { id: '1000001682', name: '电子' }, { id: '1000001795', name: '伤感' }, { id: '1000001762', name: '国语' }],
}
const PLAYLIST_SORTS: Record<DiscoverySource, Array<{ id: DiscoveryPlaylistSort; name: string }>> = {
  tx: [{ id: 'hot', name: '最热' }, { id: 'new', name: '最新' }],
  wy: [{ id: 'hot', name: '最热' }],
  kw: [{ id: 'new', name: '最新' }, { id: 'hot', name: '最热' }],
  kg: [{ id: 'recommend', name: '推荐' }, { id: 'hot', name: '最热' }, { id: 'new', name: '最新' }, { id: 'collect', name: '热藏' }, { id: 'soar', name: '飙升' }],
  mg: [{ id: 'recommend', name: '推荐' }],
}

function getDiscoverySource(value: string | null): DiscoverySource {
  return value === 'wy' || value === 'kw' || value === 'kg' || value === 'mg' ? value : 'tx'
}

function getPlaylistPage(value: string | null): number {
  const page = Number.parseInt(value || '', 10)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

function formatPlayCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace('.0', '')}亿`
  if (value >= 10_000) return `${Math.floor(value / 10_000)}万`
  return String(value || 0)
}

function Cover({ src, icon: Icon, title }: { src: string; icon: typeof Music; title?: string }) {
  return src ? (
    <RemoteCoverImage src={src} alt="" className="aspect-square w-full rounded-lg object-cover" />
  ) : (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-primary/45 to-primary/10 px-3 text-center">
      <Icon className="h-8 w-8 shrink-0 text-primary" />
      {title && <div className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{title}</div>}
    </div>
  )
}

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const source = getDiscoverySource(searchParams.get('source'))
  const playlistPage = getPlaylistPage(searchParams.get('page'))
  const categories = PLAYLIST_CATEGORIES[source] || []
  const categoryParam = searchParams.get('category') || ''
  const category = categories.some(item => item.id === categoryParam) ? categoryParam : ''
  const sorts = PLAYLIST_SORTS[source]
  const sortParam = searchParams.get('sort')
  const playlistSort = sorts.some(item => item.id === sortParam) ? sortParam as DiscoveryPlaylistSort : sorts[0].id
  const keywordParam = searchParams.get('keyword') || ''
  const [toplists, setToplists] = useState<DiscoveryToplist[]>([])
  const [playlists, setPlaylists] = useState<DiscoveryPlaylist[]>([])
  const [keyword, setKeyword] = useState(keywordParam)
  const [loadingToplists, setLoadingToplists] = useState(true)
  const [loadingPlaylists, setLoadingPlaylists] = useState(true)
  const [toplistsError, setToplistsError] = useState<string | null>(null)
  const [playlistsError, setPlaylistsError] = useState<string | null>(null)
  const toplistRequestId = useRef(0)
  const playlistRequestId = useRef(0)

  useEffect(() => setKeyword(keywordParam), [keywordParam])

  useDebounce(() => {
    const nextKeyword = keyword.trim()
    if (nextKeyword === keywordParam) return
    const nextParams = new URLSearchParams(searchParams)
    if (nextKeyword) nextParams.set('keyword', nextKeyword)
    else nextParams.delete('keyword')
    nextParams.set('page', '1')
    setSearchParams(nextParams, { replace: true })
  }, 350, [keyword, keywordParam, searchParams, setSearchParams])

  const updatePlaylistParams = (updates: Record<string, string | undefined>) => {
    const nextParams = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(updates)) {
      if (value) nextParams.set(key, value)
      else nextParams.delete(key)
    }
    setSearchParams(nextParams)
  }

  const loadToplists = async () => {
    const requestId = ++toplistRequestId.current
    setLoadingToplists(true)
    setToplistsError(null)
    try {
      const boardData = await getToplists(source)
      if (requestId === toplistRequestId.current) setToplists(boardData)
    } catch (err) {
      if (requestId === toplistRequestId.current) setToplistsError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (requestId === toplistRequestId.current) setLoadingToplists(false)
    }
  }

  const loadPlaylists = async () => {
    const requestId = ++playlistRequestId.current
    setLoadingPlaylists(true)
    setPlaylistsError(null)
    try {
      const playlistData = await getRecommendedPlaylists(source, PLAYLIST_PAGE_SIZE, playlistPage, { tag: category || undefined, sort: playlistSort, keyword: keywordParam || undefined })
      if (requestId === playlistRequestId.current) setPlaylists(playlistData)
    } catch (err) {
      if (requestId === playlistRequestId.current) setPlaylistsError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (requestId === playlistRequestId.current) setLoadingPlaylists(false)
    }
  }

  useEffect(() => {
    void loadToplists()
    // 渠道变化时才需要重新加载榜单。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  useEffect(() => {
    void loadPlaylists()
    // 歌单区域响应翻页、筛选及已防抖的关键字变化；关键字由服务端搜索接口处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, playlistPage, category, playlistSort, keywordParam])

  const isLastPlaylistPage = playlists.length < PLAYLIST_PAGE_SIZE
  const isLoading = loadingToplists || loadingPlaylists

  const refresh = () => {
    void Promise.all([loadToplists(), loadPlaylists()])
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="hidden md:block"><h1 className="text-2xl font-bold">发现音乐</h1><p className="text-sm text-muted-foreground">各平台实时榜单与精选歌单</p></div>
        <button onClick={refresh} className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent" disabled={isLoading}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> 刷新</button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="音乐渠道">
        {CHANNELS.map(channel => (
          <button key={channel.source} onClick={() => { setSearchParams({ source: channel.source }); setToplists([]); setPlaylists([]) }} className={`rounded-full px-4 py-2 text-sm transition ${source === channel.source ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`} role="tab" aria-selected={source === channel.source}>{channel.label}</button>
        ))}
      </div>
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">排行榜</h2></div>
        {loadingToplists ? <LoadingSkeleton count={6} /> : toplistsError ? (
          <EmptyState icon={Music} title="排行榜加载失败" description={toplistsError} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {toplists.map(item => (
              <Link key={item.id} to={`/discover/toplists/${item.id}?source=${source}`} className="group rounded-lg p-2 transition hover:bg-accent/50">
                <Cover src={item.cover} icon={Trophy} title={item.name} />
                <div className="mt-2 truncate text-sm font-medium group-hover:text-primary">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">{item.description}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ListMusic className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">推荐歌单</h2></div><div className="flex flex-wrap items-center gap-2"><label className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索歌单" className="h-9 w-40 rounded-md border border-border bg-transparent pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary" /></label><select value={category} onChange={event => updatePlaylistParams({ category: event.target.value || undefined, page: '1' })} className="h-9 rounded-md border border-border bg-background px-2 text-sm">{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={playlistSort} onChange={event => updatePlaylistParams({ sort: event.target.value, page: '1' })} className="h-9 rounded-md border border-border bg-background px-2 text-sm">{sorts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
        {loadingPlaylists && playlists.length === 0 ? <LoadingSkeleton count={PLAYLIST_PAGE_SIZE} /> : playlistsError ? (
          <EmptyState icon={ListMusic} title="推荐歌单加载失败" description={playlistsError} />
        ) : playlists.length === 0 ? <EmptyState icon={ListMusic} title="暂无推荐歌单" /> : (
          <div className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${loadingPlaylists ? 'pointer-events-none opacity-50' : ''}`} aria-busy={loadingPlaylists}>
            {playlists.map(item => (
              <Link key={item.id} to={`/discover/playlists/${item.id}?source=${source}`} className="group rounded-lg p-2 transition hover:bg-accent/50">
                <div className="relative"><Cover src={item.cover} icon={ListMusic} />{item.playCount > 0 && <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white"><Play className="h-3 w-3 fill-current" />{formatPlayCount(item.playCount)}</span>}</div>
                <div className="mt-2 line-clamp-2 text-sm font-medium group-hover:text-primary">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">{item.author}{item.songCount && item.songCount > 0 ? ` · ${item.songCount} 首` : ''}</div>
              </Link>
            ))}
          </div>
        )}
        {(playlists.length > 0 || playlistPage > 1) && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button onClick={() => updatePlaylistParams({ page: String(Math.max(1, playlistPage - 1)) })} disabled={playlistPage === 1 || loadingPlaylists} className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft className="h-4 w-4" /> 上一页</button>
            <span className="text-sm text-muted-foreground">第 {playlistPage} 页</span>
            <button onClick={() => updatePlaylistParams({ page: String(playlistPage + 1) })} disabled={isLastPlaylistPage || loadingPlaylists} className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">下一页 <ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </section>
    </div>
  )
}
