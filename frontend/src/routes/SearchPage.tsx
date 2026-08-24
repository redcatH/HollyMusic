import { useRef } from 'react'
import { useSearch } from '@/hooks/useSearch'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Search, Music, X, CloudOff } from 'lucide-react'
import { toTrack } from '@/lib/types/player'
import type { SourceType } from '@/lib/types/music'

const SOURCES: { value: SourceType | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'tx', label: 'QQ' },
  { value: 'wy', label: '网易' },
  { value: 'kw', label: '酷我' },
  { value: 'kg', label: '酷狗' },
  { value: 'mg', label: '咪咕' },
]

export function SearchPage() {
  // keyword/source/results/loading 全部来自 search-store（外部状态）：
  // 离开搜索页再回来时输入框与结果都保留。
  const { results, loading, error, keyword, lastKeyword, source, setKeyword, setSource, run } = useSearch()
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    run(keyword, source)
  }

  // 与 lx-music 搜索页一致：已有搜索词时切换源自动重搜，否则仅切换选中态
  const handleSourceChange = (next: SourceType | 'all') => {
    setSource(next)
    if (keyword.trim()) run(keyword, next)
  }

  const clearKeyword = () => {
    setKeyword('')
    inputRef.current?.focus()
  }

  const tracks = results.map(s => toTrack({ uid: s.uid, musicInfo: s }))

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">搜索</h1>
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
        className="mb-6 flex gap-2 overflow-x-auto pb-1"
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

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <EmptyState icon={CloudOff} title="搜索服务不可用" description={error} />
      ) : tracks.length > 0 ? (
        <SongList tracks={tracks} />
      ) : lastKeyword ? (
        // 用 lastKeyword（最近一次搜索的词）而非输入框实时文本：
        // 输入过程中/清空再输入时不应显示"未找到结果"
        <EmptyState icon={Search} title="未找到结果" description={`没有找到与“${lastKeyword}”相关的内容`} />
      ) : (
        <EmptyState icon={Music} title="开始搜索" description="输入歌曲名或歌手名开始探索" />
      )}
    </div>
  )
}
