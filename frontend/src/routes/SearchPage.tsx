import { useState } from 'react'
import { useSearch } from '@/hooks/useSearch'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { AddToPlaylistDialog } from '@/components/playlists/AddToPlaylistDialog'
import { Search, Music } from 'lucide-react'
import { toTrack, type Track } from '@/lib/types/player'
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
  const { results, loading, run } = useSearch()
  const [keyword, setKeyword] = useState('')
  const [source, setSource] = useState<SourceType | 'all'>('all')
  const [addTrack, setAddTrack] = useState<Track | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    run(keyword, source)
  }

  const tracks = results.map(s => toTrack({ uid: s.uid, musicInfo: s }))

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">搜索</h1>
      <form onSubmit={submit} className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜索歌曲、歌手..."
            className="w-full rounded-full bg-card py-2 pl-10 pr-4 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
        </div>
        <select
          value={source}
          onChange={e => setSource(e.target.value as SourceType | 'all')}
          className="rounded-full bg-card px-3 py-2 text-sm ring-1 ring-border focus:outline-none focus:ring-primary"
        >
          {SOURCES.map(s => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </form>

      {loading ? (
        <LoadingSkeleton />
      ) : tracks.length > 0 ? (
        <SongList tracks={tracks} onAddToPlaylist={t => setAddTrack(t)} />
      ) : keyword ? (
        <EmptyState icon={Search} title="未找到结果" />
      ) : (
        <EmptyState icon={Music} title="开始搜索" description="输入歌曲名或歌手名开始探索" />
      )}

      {addTrack && <AddToPlaylistDialog uid={addTrack.uid} onClose={() => setAddTrack(null)} />}
    </div>
  )
}
