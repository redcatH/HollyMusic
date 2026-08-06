import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Check,
  Loader2,
  ListChecks,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CoverImage } from '@/components/shared/CoverImage'
import { SourceBadge } from '@/components/shared/SourceBadge'
import type { Song } from '@/lib/types/music'
import type { ConfirmSong, ProcessingState } from '@@/hooks/useAiPlaylist'

interface Props {
  confirmSongs: ConfirmSong[]
  selectedUids: Set<string>
  toggleUid: (uid: string) => void
  processing: ProcessingState | null
  creating: boolean
  createError: string
  createdId: number | null
  onBack: () => void
  onCreate: () => void
  onView: () => void
}

export function StepConfirm({
  confirmSongs,
  selectedUids,
  toggleUid,
  processing,
  creating,
  createError,
  createdId,
  onBack,
  onCreate,
  onView,
}: Props) {
  const [showRemoved, setShowRemoved] = useState(false)
  const keepSongs = confirmSongs.filter((c) => c.action === 'keep')
  const removeSongs = confirmSongs.filter((c) => c.action === 'remove')

  if (createdId !== null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/15"
        >
          <ListChecks className="h-9 w-9 text-primary" />
        </motion.div>
        <div className="mb-1 text-xl font-bold">歌单已创建</div>
        <div className="mb-6 text-sm text-muted-foreground">已加入 {selectedUids.size} 首歌</div>
        <button
          onClick={onView}
          className="touch-target flex items-center gap-1.5 rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 active:scale-[0.99]"
        >
          查看歌单 <ExternalLink className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 pt-5">
        <h2 className="text-xl font-bold">确认并创建</h2>
        <p className="mt-1 text-sm text-muted-foreground">AI 已筛掉不合适的版本，确认后创建歌单。</p>

        {processing && (
          <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {processing.message}
          </div>
        )}

        <div className="mt-4 mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">推荐歌曲（{keepSongs.length}）</span>
          <span className="text-xs text-muted-foreground/70">已选 {selectedUids.size}</span>
        </div>

        <div className="space-y-0.5">
          {keepSongs.map((c) => (
            <SongCheckRow
              key={c.song.uid}
              song={c.song}
              checked={selectedUids.has(c.song.uid)}
              onToggle={() => toggleUid(c.song.uid)}
            />
          ))}
        </div>

        {removeSongs.length > 0 && (
          <div className="mt-4 pb-2">
            <button
              onClick={() => setShowRemoved((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              {showRemoved ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              AI 建议排除（{removeSongs.length}）
            </button>
            {showRemoved && (
              <div className="mt-2 space-y-1 opacity-50">
                {removeSongs.map((c) => (
                  <div key={c.song.uid} className="flex items-center gap-3 py-1.5">
                    <CoverImage uid={c.song.uid} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs">{c.song.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {c.song.singer} · {c.reason}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {createError && (
        <div className="mx-5 mb-1 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {createError}
        </div>
      )}

      <div className="flex gap-2 px-5 pb-5 pt-2">
        <button
          onClick={onBack}
          disabled={creating}
          className="touch-target flex items-center justify-center gap-1 rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground transition hover:bg-accent disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" /> 上一步
        </button>
        <button
          onClick={onCreate}
          disabled={creating || selectedUids.size === 0}
          className="touch-target flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:shadow-none"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {creating ? '创建中…' : `创建歌单(${selectedUids.size})`}
        </button>
      </div>
    </div>
  )
}

function SongCheckRow({
  song,
  checked,
  onToggle,
}: {
  song: Song
  checked: boolean
  onToggle: () => void
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-accent/50"
    >
      <motion.span
        animate={{ scale: checked ? 1 : 0.85 }}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </motion.span>
      <CoverImage uid={song.uid} className="h-10 w-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{song.name}</div>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-muted-foreground">{song.singer}</span>
          <SourceBadge source={song.source} />
        </div>
      </div>
    </motion.button>
  )
}
