import { getBestQuality } from '@/lib/quality-utils'
import type { MusicInfo } from '@/lib/types/music'

export function QualityBadge({ musicInfo }: { musicInfo: MusicInfo }) {
  const q = getBestQuality(musicInfo.types)
  if (q === 'unknown') return null
  const label = q === 'flac24bit' ? 'Hi-Res' : q.toUpperCase()
  const isLossless = q === 'flac' || q === 'flac24bit'
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isLossless ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      {label}
    </span>
  )
}
