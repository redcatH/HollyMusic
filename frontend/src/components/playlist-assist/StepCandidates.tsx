import { motion } from 'framer-motion'
import { ChevronLeft, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiPlaylistGenerateResult } from '@/lib/api/playlist-assist'

interface Props {
  generateResult: AiPlaylistGenerateResult
  selectedItems: Set<string>
  toggleItem: (item: string) => void
  playlistName: string
  setPlaylistName: (v: string) => void
  onBack: () => void
  onNext: () => void
}

export function StepCandidates({
  generateResult,
  selectedItems,
  toggleItem,
  playlistName,
  setPlaylistName,
  onBack,
  onNext,
}: Props) {
  const count = selectedItems.size
  const modeLabel = generateResult.mode === 'artists' ? '按歌手' : '按歌曲'
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 pt-5">
        <h2 className="text-xl font-bold">确认候选</h2>
        <p className="mt-1 text-sm text-muted-foreground">AI 判断的选曲方向，点按取消不需要的。</p>

        <div className="mt-4">
          <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary">
            {modeLabel}
          </span>
        </div>

        <label className="mt-4 mb-1.5 block text-xs font-medium text-muted-foreground">歌单名称</label>
        <input
          value={playlistName}
          onChange={(e) => setPlaylistName(e.target.value)}
          maxLength={24}
          className="w-full rounded-xl bg-muted/40 px-3.5 py-2.5 text-base outline-none ring-1 ring-transparent transition focus:bg-background focus:ring-primary"
        />

        <div className="mt-4 mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">候选词</span>
          <span className="text-xs text-muted-foreground/70">
            已选 {count}/{generateResult.items.length}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pb-2">
          {generateResult.items.map((it) => {
            const checked = selectedItems.has(it)
            return (
              <motion.button
                key={it}
                whileTap={{ scale: 0.92 }}
                onClick={() => toggleItem(it)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm ring-1 transition',
                  checked
                    ? 'bg-primary/15 text-primary ring-primary/50'
                    : 'bg-muted/50 text-muted-foreground/60 ring-transparent line-through',
                )}
              >
                {it}
              </motion.button>
            )
          })}
        </div>
      </div>

      <div className="flex gap-2 px-5 pb-5 pt-2">
        <button
          onClick={onBack}
          className="touch-target flex items-center justify-center gap-1 rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground transition hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" /> 上一步
        </button>
        <button
          onClick={onNext}
          disabled={count === 0}
          className="touch-target flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:shadow-none"
        >
          <Search className="h-4 w-4" /> 搜索这 {count} 个
        </button>
      </div>
    </div>
  )
}
