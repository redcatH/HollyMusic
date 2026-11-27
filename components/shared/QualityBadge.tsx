import { useTrackQualities } from '@/hooks/useTrackQualities'
import { getBestQuality } from '@/lib/quality-utils'
import { QUALITY_LABEL } from '@/lib/quality-options'
import type { MusicInfo } from '@/lib/types/music'

export function QualityBadge({ uid, musicInfo }: { uid?: string; musicInfo: MusicInfo }) {
  const types = useTrackQualities(uid, musicInfo.types)
  const q = getBestQuality(types)
  const surround = types?.some(item => item.type === 'atmos_plus') ? 'atmos_plus'
    : types?.some(item => item.type === 'atmos') ? 'atmos' : null
  const master = types?.some(item => item.type === 'master')
  if (q === 'unknown' && !surround && !master) return null
  const stereoLabel = q === 'unknown' ? null : q === '192k' ? '192K' : QUALITY_LABEL[q]
  const label = [master ? QUALITY_LABEL.master : stereoLabel, surround && QUALITY_LABEL[surround]].filter(Boolean).join(' · ')
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
