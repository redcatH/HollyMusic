/**
 * 播放栏通用工具按钮。
 *
 * 解决旧版「裸图标 + muted 灰 + 无容器」导致的不明显/难猜/难点中：
 * - p-2 命中区 ~36px，rounded-md hover:bg-accent 提供容器反馈
 * - 默认 text-foreground/70（比 muted 亮），active 态 text-primary
 * - title 原生 tooltip（hover 显示含义，解决「猜」）
 * - showLabel：图标 + 文字（桌面高频入口「歌词」「队列」用）
 */

import type { LucideIcon } from 'lucide-react'

interface PlayerButtonProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  active?: boolean
  showLabel?: boolean
  size?: 'sm' | 'md'
  disabled?: boolean
}

export function PlayerButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  showLabel = false,
  size = 'md',
  disabled = false,
}: PlayerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
        active ? 'text-primary' : 'text-foreground/70 hover:text-foreground'
      }`}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
      {showLabel && <span className="text-xs font-medium">{label}</span>}
    </button>
  )
}
