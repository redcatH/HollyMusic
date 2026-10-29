import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSearch } from '@/hooks/useSearch'
import { useSearchStore } from '@/lib/store/search-store'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Search, Music, X, CloudOff, Loader2 } from 'lucide-react'
import { toTrack } from '@/lib/types/player'
import type { SourceType } from '@/lib/types/music'

const SOURCES: { value: SourceType | 'all'; label: string }[] = [
  { value: 'all', label: '全部平台' },
  { value: 'tx', label: 'QQ' },
  { value: 'wy', label: '网易' },
  { value: 'kw', label: '酷我' },
  { value: 'kg', label: '酷狗' },
  { value: 'mg', label: '咪咕' },
]

export function SearchPage() {
  // keyword/source/results/loading 全部来自 search-store（外部状态）：
  // 离开搜索页再回来时输入框与结果都保留。
  const { results, loading, pendingSources, error, keyword, lastKeyword, source, lastSource,
    nextPage, loadingMore, loadMoreError, sourceErrors, loadMore, retrySource, setKeyword, setSource, run } = useSearch()
  const inputRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const initialized = useRef(false)
  const memoryDraft = useRef<{ keyword: string; source: SourceType | 'all' } | null>(null)

  useEffect(() => {
    const state = useSearchStore.getState()
    // 从站内导航返回搜索页，沿用已有结果并补齐可刷新的 URL。
    if (!initialized.current && !searchParams.has('q') && !searchParams.has('source') && state.lastKeyword) {
      memoryDraft.current ??= { keyword: state.keyword, source: state.source }
      setSearchParams({ q: state.lastKeyword, source: state.lastSource }, { replace: true })
      return
    }
    initialized.current = true
    const query = (searchParams.get('q') || '').trim()
    const selected = SOURCES.find(item => item.value === searchParams.get('source'))?.value ?? 'all'
    state.setKeyword(memoryDraft.current?.keyword ?? query)
    state.setSource(memoryDraft.current?.source ?? selected)
    memoryDraft.current = null
    if (state.lastKeyword !== query || state.lastSource !== selected) void state.run(query, selected)
  }, [searchParams, setSearchParams])

  const commitSearch = (query: string, selected: SourceType | 'all') => {
    const trimmed = query.trim()
    setKeyword(trimmed)
    setSource(selected)
    if (searchParams.get('q') === trimmed && (searchParams.get('source') || 'all') === selected) {
      void run(trimmed, selected)
    } else setSearchParams({ q: trimmed, source: selected })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    commitSearch(keyword, source)
  }

  // 与 lx-music 搜索页一致：已有搜索词时切换源自动重搜，否则仅切换选中态
  const handleSourceChange = (next: SourceType | 'all') => {
    commitSearch(keyword, next)
  }

  const clearKeyword = () => {
    commitSearch('', source)
    inputRef.current?.focus()
  }

  const tracks = useMemo(() => results.map(s => toTrack({ uid: s.uid, musicInfo: s })), [results])

  return (
    <div className="page-shell">
      {/* 小屏下 MobileHeader 已显示页面标题，页内大标题仅桌面保留 */}
      <h1 className="page-title mb-6 hidden desktop:block">搜索</h1>
      <form onSubmit={submit} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜索歌曲、歌手..."
            enterKeyHint="search"
            className="w-full rounded-full bg-card py-2 pl-10 pr-9 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
          {keyword && (
            <button
              type="button"
              aria-label="清空搜索词"
              onClick={clearKeyword}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          搜索
        </button>
      </form>

      <div
        role="tablist"
        aria-label="音源"
        className="scrollbar-hidden mb-6 flex gap-2 overflow-x-auto pb-1"
      >
        {SOURCES.map(s => (
          <button
            key={s.value}
            role="tab"
            aria-selected={source === s.value}
            onClick={() => handleSourceChange(s.value)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              source === s.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground ring-1 ring-border hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {lastKeyword && lastSource === 'all' && (
        <p className="mb-3 text-xs text-muted-foreground">展示各平台的首批结果，查看更多请切换平台。</p>
      )}
      {SOURCES.filter(s => s.value !== 'all' && sourceErrors[s.value]).map(s => (
        <div key={s.value} className="mb-3 flex items-center gap-2 text-sm" role="status">
          <span className="text-muted-foreground">{s.label}加载失败</span>
          <button type="button" onClick={() => void retrySource(s.value as SourceType)} className="min-h-9 px-2 text-primary">重试{s.label}</button>
        </div>
      ))}
      {tracks.length > 0 && pendingSources > 0 && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在搜索其他渠道…
        </div>
      )}
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <EmptyState icon={CloudOff} title="搜索服务不可用" description={error} />
      ) : tracks.length > 0 ? (
        <>
          <p className="mb-3 text-xs text-muted-foreground">已加载 {tracks.length} 首</p>
          <SongList tracks={tracks} />
        </>
      ) : lastKeyword ? (
        // 用 lastKeyword（最近一次搜索的词）而非输入框实时文本：
        // 输入过程中/清空再输入时不应显示"未找到结果"
        <EmptyState icon={Search} title="未找到结果" description={`没有找到与“${lastKeyword}”相关的内容`} />
      ) : (
        <EmptyState icon={Music} title="开始搜索" description="输入歌曲名或歌手名开始探索" />
      )}
      {!loading && !error && lastKeyword && lastSource !== 'all' && (
        <div className="mt-5 flex flex-col items-center gap-2 pb-4" aria-live="polite">
          {loadMoreError && <p className="text-sm text-muted-foreground" role="alert">{loadMoreError}</p>}
          {nextPage !== null ? (
            <button type="button" disabled={loadingMore} onClick={() => void loadMore()}
              className="flex min-h-11 items-center gap-2 rounded-full border border-border px-6 py-2 text-sm hover:bg-accent disabled:opacity-60">
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              {loadingMore ? '正在加载…' : loadMoreError ? '重试加载' : '加载更多'}
            </button>
          ) : tracks.length > 0 ? <p className="text-xs text-muted-foreground">已加载全部可获取结果</p> : null}
        </div>
      )}
    </div>
  )
}
