import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { AssistStep } from '@@/hooks/useAiPlaylist'

const LABELS = ['需求', '候选', '处理', '确认']

export function StepIndicator({ current }: { current: AssistStep }) {
  return (
    <div className="flex items-center gap-1.5">
      {LABELS.map((label, i) => {
        const active = i === current
        const done = i < current
        return (
          <div key={label} className="flex flex-1 flex-col gap-1">
            <div className="relative h-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                initial={false}
                animate={{ width: active || done ? '100%' : '0%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            </div>
            <span
              className={cn(
                'text-center text-[10px] transition-colors',
                active ? 'font-medium text-primary' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
