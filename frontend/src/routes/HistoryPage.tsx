import { usePlayHistory } from '@/hooks/usePlayHistory'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { History, Trash2 } from 'lucide-react'
import { toTrack, type Track } from '@/lib/types/player'

export function HistoryPage() {
  const { entries, loading, clear } = usePlayHistory()

  const tracks: Track[] = entries
    .filter(e => e.musicInfo && e.songId)
    .map(e => toTrack({ uid: e.songId!, musicInfo: e.musicInfo! }))

  const handleClear = async () => {
    if (!confirm('清空所有播放历史？')) return
    await clear()
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">播放历史</h1>
        {tracks.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" /> 清空
          </button>
        )}
      </div>
      {loading ? (
        <LoadingSkeleton />
      ) : tracks.length > 0 ? (
        <SongList tracks={tracks} />
      ) : (
        <EmptyState icon={History} title="暂无播放记录" description="播放过的歌曲会自动保存到这里" />
      )}
    </div>
  )
}
