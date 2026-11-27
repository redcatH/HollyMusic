import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useDebounce } from 'react-use'
import { ArrowUpRight, ChevronLeft, ChevronRight, ListMusic, Music, Play, RefreshCw, Search, Trophy } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { RemoteCoverImage } from '@/components/shared/RemoteCoverImage'
import { getRecommendedPlaylists, getToplists } from '@/lib/api/discovery'
import { getPlatformCatalog } from '@/lib/api/platforms'
import { usePlatforms } from '@/hooks/usePlatforms'
import type { CatalogItem } from '@/lib/server/platform-plugin-contract'
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
  tx: [{ id: 'recommend', name: '推荐' }, { id: 'hot', name: '最热' }, { id: 'new', name: '最新' }],
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
    <RemoteCoverImage src={src} alt="" className="aspect-square w-full rounded-xl object-cover" />
  ) : (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 px-3 text-center">
      <Icon className="h-8 w-8 shrink-0 text-primary" />
      {title && <div className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{title}</div>}
    </div>
  )
}

export function HomePage({ active = true }: { active?: boolean }) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const detailState = { discoveryFrom: location.pathname + location.search + location.hash }
  const platforms = usePlatforms()
  const channels = platforms.filter(item => item.capabilities.some(capability => capability !== 'searchSongs'))
  const platform = platforms.find(item => item.id === searchParams.get('source'))
  const source = platform?.id ?? getDiscoverySource(searchParams.get('source'))
  const supports = (name: import('@/lib/platform-plugins').PluginCapability) => !platform || platform.capabilities.includes(name)
  const overridden = (name: import('@/lib/platform-plugins').PluginCapability) => platform?.pluginCapabilities?.includes(name) === true
  const hasPluginCategories = overridden('listPlaylistCategories') && overridden('listPlaylists')
  const playlistPage = getPlaylistPage(searchParams.get('page'))
  const [pluginCategories, setPluginCategories] = useState<{ source: string; items: CatalogItem[] }>()
  const categories = hasPluginCategories ? (pluginCategories?.source === source ? pluginCategories.items : []) : PLAYLIST_CATEGORIES[source] || []
  const categoryParam = searchParams.get('category') || ''
  const category = categories.some(item => item.id === categoryParam) ? categoryParam : ''
  const sorts = overridden('listPlaylists') ? [{ id: 'recommend' as const, name: '推荐' }] : PLAYLIST_SORTS[source] ?? [{ id: 'recommend' as const, name: '推荐' }]
  const sortParam = searchParams.get('sort')
  const playlistSort = sorts.some(item => item.id === sortParam) ? sortParam as DiscoveryPlaylistSort : sorts[0].id
  const keywordParam = searchParams.get('keyword') || ''
  const [toplists, setToplists] = useState<DiscoveryToplist[]>([])
  const [playlists, setPlaylists] = useState<DiscoveryPlaylist[]>([])
  const [listCursor, setListCursor] = useState<string>()
  const [radios, setRadios] = useState<{ source: string; items: CatalogItem[]; error?: string }>()
  const [reloadEpoch, setReloadEpoch] = useState(0)
  const [keyword, setKeyword] = useState(keywordParam)
  const [loadingToplists, setLoadingToplists] = useState(true)
  const [loadingPlaylists, setLoadingPlaylists] = useState(true)
  const [showAllToplists, setShowAllToplists] = useState(false)
  const [toplistsError, setToplistsError] = useState<string | null>(null)
  const [playlistsError, setPlaylistsError] = useState<string | null>(null)
  const toplistRequestId = useRef(0)
  const playlistRequestId = useRef(0)
  const cursorHistory = useRef(new Map<string, string>())
  const playlistCapability = keywordParam ? 'searchPlaylists' : 'listPlaylists'
  const usePluginPlaylists = overridden(playlistCapability)
  const hasRadio = overridden('listRadioStations')
  const hasCharts = supports('listCharts')
  const hasPlaylists = supports('listPlaylists') || supports('searchPlaylists')
  const playlistKey = JSON.stringify([source, keywordParam, category])

  useEffect(() => setKeyword(keywordParam), [keywordParam])

  useDebounce(() => {
    if (!active) return
    const nextKeyword = keyword.trim()
    if (nextKeyword === keywordParam) return
    const nextParams = new URLSearchParams(searchParams)
    if (nextKeyword) nextParams.set('keyword', nextKeyword)
    else nextParams.delete('keyword')
    nextParams.set('page', '1')
    setSearchParams(nextParams, { replace: true })
  }, 350, [active, keyword, keywordParam, searchParams, setSearchParams])

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
      const boardData = hasCharts ? await getToplists(source) : []
      if (requestId === toplistRequestId.current) setToplists(boardData)
    } catch (err) {
      if (requestId === toplistRequestId.current) setToplistsError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (requestId === toplistRequestId.current) setLoadingToplists(false)
    }
  }

  const loadPlaylists = async (refresh = false) => {
    const requestId = ++playlistRequestId.current
    setLoadingPlaylists(true)
    setPlaylistsError(null)
    try {
      let items: DiscoveryPlaylist[] = []
      let next: string | undefined
      if (usePluginPlaylists) {
        const cursor = cursorHistory.current.get(`${playlistKey}:${playlistPage}`)
        const data = await getPlatformCatalog<CatalogItem>(source, playlistCapability, { limit: PLAYLIST_PAGE_SIZE, page: playlistPage,
          categoryId: !keywordParam && category ? category : undefined, keyword: keywordParam || undefined, cursor, refresh: refresh ? 1 : undefined })
        items = data.items
        next = data.nextCursor
      } else if (supports(playlistCapability)) {
        items = await getRecommendedPlaylists(source, PLAYLIST_PAGE_SIZE, playlistPage, { tag: category || undefined, sort: playlistSort, keyword: keywordParam || undefined })
      }
      if (requestId === playlistRequestId.current) {
        setPlaylists(items)
        setListCursor(next)
      }
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
  }, [source, hasCharts])

  useEffect(() => {
    void loadPlaylists()
    // 歌单区域响应翻页、筛选及已防抖的关键字变化；关键字由服务端搜索接口处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, playlistPage, category, playlistSort, keywordParam, usePluginPlaylists, hasPlaylists])

  useEffect(() => {
    if (!hasPluginCategories) return
    const controller = new AbortController()
    void getPlatformCatalog<CatalogItem>(source, 'listPlaylistCategories', { limit: 100, refresh: reloadEpoch ? 1 : undefined }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setPluginCategories({ source, items: data.items }) }).catch(() => {})
    return () => controller.abort()
  }, [source, hasPluginCategories, reloadEpoch])

  useEffect(() => {
    if (!hasRadio) return
    const controller = new AbortController()
    void getPlatformCatalog<CatalogItem>(source, 'listRadioStations', { limit: 30, refresh: reloadEpoch ? 1 : undefined }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setRadios({ source, items: data.items }) })
      .catch(error => { if (!controller.signal.aborted) setRadios({ source, items: [], error: error.message }) })
    return () => controller.abort()
  }, [source, hasRadio, reloadEpoch])

  const isLastPlaylistPage = usePluginPlaylists ? !listCursor : playlists.length < PLAYLIST_PAGE_SIZE
  const isLoading = loadingToplists || loadingPlaylists
  const featuredPlaylist = supports('getPlaylist') ? playlists[0] : undefined
  const visibleToplists = showAllToplists ? toplists : toplists.slice(0, 4)

  const refresh = () => {
    setReloadEpoch(previous => previous + 1)
    void Promise.all([loadToplists(), loadPlaylists(true)])
  }

  return (
    <div className="page-shell">
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 border-b border-border/50 pb-3 desktop:mb-6 desktop:gap-x-3 desktop:gap-y-6">
        <div className="hidden desktop:block"><h1 className="page-title">发现音乐</h1><p className="mt-2 text-sm text-muted-foreground">从熟悉的旋律，到下一首心动。</p></div>
        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1 desktop:gap-2">
          <Link to="/search" className="flex h-10 w-9 items-center justify-center gap-2 rounded-full border border-border/60 bg-card text-sm text-muted-foreground transition hover:border-primary/30 hover:text-primary desktop:w-auto desktop:px-3" aria-label="搜索音乐"><Search className="h-4 w-4" /><span className="hidden desktop:inline">搜索歌曲、歌手</span></Link>
          <button onClick={refresh} className="flex h-10 w-9 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground transition hover:border-primary/30 hover:text-primary disabled:opacity-50 desktop:w-10" disabled={isLoading} aria-label="刷新"><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></button>
        </div>

        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden desktop:col-span-2 desktop:row-start-2 desktop:flex-wrap desktop:gap-1" role="tablist" aria-label="音乐渠道">
          {channels.map(item => ({ source: item.id, label: CHANNELS.find(channel => channel.source === item.id)?.label ?? item.name })).map(channel => (
            <button key={channel.source} onClick={() => { setSearchParams({ source: channel.source }); setToplists([]); setPlaylists([]); setShowAllToplists(false) }} className={`min-h-10 shrink-0 whitespace-nowrap rounded-full px-2 py-2 text-xs font-medium transition sm:px-4 sm:text-sm ${source === channel.source ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`} role="tab" aria-label={channel.label} aria-selected={source === channel.source}>
              {channel.label.slice(0, 2)}<span className="hidden desktop:inline">{channel.label.slice(2)}</span>
            </button>
          ))}
        </div>
      </div>

      {featuredPlaylist && !keywordParam && (
        <Link to={`/discover/playlists/${featuredPlaylist.id}?source=${source}`} state={detailState} aria-label={`打开精选歌单：${featuredPlaylist.name}`} className="feature-surface group mb-8 flex min-h-44 items-center justify-between gap-4 overflow-hidden rounded-3xl border border-border/50 p-5 transition hover:border-primary/25 sm:min-h-52 sm:gap-7 sm:p-7">
          <div className="min-w-0 flex-1">
            <span className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium tracking-wider text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> 歌单精选</span>
            <h2 className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight sm:text-2xl lg:text-[28px]">{featuredPlaylist.name}</h2>
            <p className="mt-2 truncate text-xs text-muted-foreground sm:text-sm">{featuredPlaylist.author}{featuredPlaylist.songCount ? ` · ${featuredPlaylist.songCount} 首音乐` : ''}</p>
            <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground sm:text-sm">探索歌单 <ArrowUpRight className="h-3.5 w-3.5" /></span>
          </div>
          <div className="relative mr-1 w-24 shrink-0 sm:mr-4 sm:w-36 lg:mr-5 lg:w-40" aria-hidden="true">
            {playlists[1] && <div className="absolute inset-0 translate-x-3 rotate-12 opacity-40 sm:translate-x-5"><Cover src={playlists[1].cover} icon={ListMusic} /></div>}
            <div className="featured-art relative -rotate-6 rounded-xl"><Cover src={featuredPlaylist.cover} icon={ListMusic} /></div>
          </div>
        </Link>
      )}

      {hasCharts && <section className="mb-8">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="section-title">正在流行</h2>
          {toplists.length > 4 && <button type="button" onClick={() => setShowAllToplists(value => !value)} aria-expanded={showAllToplists} className="flex min-h-9 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">{showAllToplists ? '收起榜单' : `全部榜单 · ${toplists.length}`}<ChevronRight className={`h-3.5 w-3.5 transition-transform ${showAllToplists ? '-rotate-90' : ''}`} /></button>}
        </div>
        {loadingToplists ? <LoadingSkeleton count={6} /> : toplistsError ? (
          <EmptyState icon={Music} title="排行榜加载失败" description={toplistsError} />
        ) : (
          <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2 2xl:grid-cols-4">
            {visibleToplists.map(item => (
              <Link key={item.id} to={supports('getChart') ? `/discover/toplists/${encodeURIComponent(item.id)}?source=${source}` : '#'} aria-disabled={!supports('getChart')} onClick={event => { if (!supports('getChart')) event.preventDefault() }} state={detailState} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border/50 bg-card/80 p-2.5 transition hover:border-primary/25 hover:bg-card hover:shadow-sm">
                <div className="w-12 shrink-0"><Cover src={item.cover} icon={Trophy} /></div>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold group-hover:text-primary">{item.name}</div><div className="mt-1 truncate text-xs text-muted-foreground">{item.description || '聆听此刻的热门音乐'}</div></div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </section>}

      {hasRadio && <section className="mb-8">
        <h2 className="section-title mb-4">漫游电台</h2>
        {radios?.source !== source ? <LoadingSkeleton count={3} /> : radios.error ? <EmptyState icon={Music} title="漫游电台加载失败" description={radios.error} /> :
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{radios.items.map(item => (
            <Link key={item.id} to={supports('getRadioTracks') ? `/discover/radios/${encodeURIComponent(item.id)}?source=${source}` : '#'} aria-disabled={!supports('getRadioTracks')}
              onClick={event => { if (!supports('getRadioTracks')) event.preventDefault() }} state={detailState}
              className="rounded-xl border border-border/60 bg-card p-3 text-sm hover:text-primary">{item.name}</Link>
          ))}</div>}
      </section>}

      {hasPlaylists && <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">发现好歌单</h2>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {supports('searchPlaylists') && <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索歌单" aria-label="搜索歌单" className="h-9 w-36 rounded-full border border-border/60 bg-card pl-8 pr-2 text-xs outline-none focus:ring-1 focus:ring-primary" /></label>}
            {categories.length > 0 && <select value={category} aria-label="歌单分类" onChange={event => updatePlaylistParams({ category: event.target.value || undefined, page: '1' })} className="h-9 rounded-full border border-border/60 bg-card px-3 text-xs">{hasPluginCategories && <option value="">全部分类</option>}{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            {sorts.length > 1 && <select value={playlistSort} aria-label="歌单排序" onChange={event => updatePlaylistParams({ sort: event.target.value, page: '1' })} className="h-9 rounded-full border border-border/60 bg-card px-3 text-xs">{sorts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            {usePluginPlaylists && !keywordParam && <button type="button" disabled={loadingPlaylists} onClick={() => void loadPlaylists(true)} className="h-9 rounded-full border border-border/60 px-3 text-xs disabled:opacity-50">换一批</button>}
          </div>
        </div>
        {loadingPlaylists && playlists.length === 0 ? <LoadingSkeleton count={PLAYLIST_PAGE_SIZE} /> : playlistsError ? (
          <EmptyState icon={ListMusic} title="推荐歌单加载失败" description={playlistsError} />
        ) : playlists.length === 0 ? <EmptyState icon={ListMusic} title="暂无推荐歌单" /> : (
          <div className={`-mx-2 grid grid-cols-2 gap-x-1 gap-y-4 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 ${loadingPlaylists ? 'pointer-events-none opacity-50' : ''}`} aria-busy={loadingPlaylists}>
            {playlists.map(item => (
              <Link key={item.id} to={supports('getPlaylist') ? `/discover/playlists/${encodeURIComponent(item.id)}?source=${source}` : '#'} aria-disabled={!supports('getPlaylist')} onClick={event => { if (!supports('getPlaylist')) event.preventDefault() }} state={detailState} className="album-tile group min-w-0 rounded-2xl p-2">
                <div className="cover-elevation relative rounded-xl"><Cover src={item.cover} icon={ListMusic} />{item.playCount > 0 && <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] text-white"><Play className="h-2.5 w-2.5 fill-current" />{formatPlayCount(item.playCount)}</span>}</div>
                <div className="mt-3 line-clamp-2 text-sm font-medium leading-relaxed group-hover:text-primary">{item.name}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{item.author}{item.songCount && item.songCount > 0 ? ` · ${item.songCount} 首` : ''}</div>
              </Link>
            ))}
          </div>
        )}
        {(usePluginPlaylists ? !!listCursor || playlistPage > 1 : playlists.length > 0 || playlistPage > 1) && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button onClick={() => updatePlaylistParams({ page: String(Math.max(1, playlistPage - 1)) })} disabled={playlistPage === 1 || loadingPlaylists} className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft className="h-4 w-4" /> 上一页</button>
            <span className="text-sm text-muted-foreground">第 {playlistPage} 页</span>
            <button onClick={() => {
              if (listCursor) cursorHistory.current.set(`${playlistKey}:${playlistPage + 1}`, listCursor)
              updatePlaylistParams({ page: String(playlistPage + 1) })
            }} disabled={isLastPlaylistPage || loadingPlaylists} className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">下一页 <ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </section>}
    </div>
  )
}
