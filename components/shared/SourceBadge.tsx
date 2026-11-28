import { knownPlatformName } from '@/lib/platform-plugins'
import type { SourceType } from '@/lib/types/music'

const SOURCE_LABELS: Record<string, string> = {
  tx: 'QQ',
  wy: '网易',
  kw: '酷我',
  kg: '酷狗',
  mg: '咪咕',
  qs: '汽水',
}

const SOURCE_COLORS: Record<string, string> = {
  tx: 'bg-green-500/20 text-green-400',
  wy: 'bg-red-500/20 text-red-400',
  kw: 'bg-yellow-500/20 text-yellow-400',
  kg: 'bg-blue-500/20 text-blue-400',
  mg: 'bg-purple-500/20 text-purple-400',
}

export function SourceBadge({ source }: { source: SourceType | string }) {
  // 插件平台没有内置短名，回退到 /api/platforms 返回的平台名称，再回退到平台 ID。
  const label = SOURCE_LABELS[source] || knownPlatformName(source) || source
  const color = SOURCE_COLORS[source] || 'bg-muted text-muted-foreground'
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {label}
    </span>
  )
}
