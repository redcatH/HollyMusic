import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronUp, Check, ListChecks } from 'lucide-react'
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
  createError: string
  createdId: number | null
  mode: 'new' | 'add'
}

export function StepConfirm({
  confirmSongs,
  selectedUids,
  toggleUid,
  processing,
  createError,
  createdId,
  mode,
}: Props) {
  const [showRemoved, setShowRemoved] = useState(false)
  const keepSongs = confirmSongs.filter((c) => c.action === 'keep')
  const removeSongs = confirmSongs.filter((c) => c.action === 'remove')

  // 成功态：由壳导航栏显示「查看歌单」，这里只展示成功画面
  if (createdId !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-8 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/15"
        >
          <ListChecks className="h-9 w-9 text-primary" />
        </motion.div>
        <div className="mb-1 text-xl font-bold">{mode === 'add' ? '已加入歌单' : '歌单已创建'}</div>
        <div className="text-sm text-muted-foreground">已加入 {selectedUids.size} 首歌</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 固定顶：标题 + 统计 */}
      <div className="shrink-0 px-5 pt-5">
        <h2 className="text-xl font-bold">确认并{mode === 'add' ? '加入' : '创建'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">AI 已筛掉不合适的版本，确认后{mode === 'add' ? '加入歌单' : '创建歌单'}。</p>

        {processing && (
          <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {processing.message}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-medium">推荐歌曲（{keepSongs.length}）</span>
          <span className="text-xs text-muted-foreground/70">已选 {selectedUids.size}</span>
        </div>
      </div>

      {/* 滚动区：keep + remove（min-h-0 保证可滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
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
          <div className="mt-4 pb-4">
            <button
              onClick={() => setShowRemoved((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              {showRemoved ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              AI 建议排除（{removeSongs.length}）· 点按可加回
            </button>
            {showRemoved && (
              <div className="mt-2 space-y-0.5">
                {removeSongs.map((c) => (
                  <SongCheckRow
                    key={c.song.uid}
                    song={c.song}
                    checked={selectedUids.has(c.song.uid)}
                    onToggle={() => toggleUid(c.song.uid)}
                    reason={c.reason}
                    dimmed
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 错误提示（按钮在壳导航栏） */}
      {createError && (
        <div className="mx-5 mb-1 shrink-0 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {createError}
        </div>
      )}
    </div>
  )
}

function SongCheckRow({
  song,
  checked,
  onToggle,
  reason,
  dimmed,
}: {
  song: Song
  checked: boolean
  onToggle: () => void
  reason?: string
  dimmed?: boolean
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-accent/50',
        dimmed && !checked && 'opacity-50',
      )}
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
          {reason && (
            <span className="truncate text-[10px] text-muted-foreground/60" title={reason}>
              · {reason}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}
