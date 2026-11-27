import { getBestQuality } from '@/lib/quality-utils'
import { QUALITY_LABEL } from '@/lib/quality-options'
import type { MusicInfo } from '@/lib/types/music'

export function QualityBadge({ musicInfo }: { musicInfo: MusicInfo }) {
  const q = getBestQuality(musicInfo.types)
  const surround = musicInfo.types?.some(item => item.type === 'atmos_plus')
  const master = musicInfo.types?.some(item => item.type === 'master')
  if (q === 'unknown' && !surround && !master) return null
  const stereoLabel = q === 'unknown' ? null : q === '192k' ? '192K' : QUALITY_LABEL[q]
  const label = [master ? QUALITY_LABEL.master : stereoLabel, surround && QUALITY_LABEL.atmos_plus].filter(Boolean).join(' · ')
  const isLossless = master || surround || q === 'flac' || q === 'flac24bit'
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
