import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Search, AlertCircle, RotateCw, CheckCircle2 } from 'lucide-react'
import type { ProcessingState } from '@@/hooks/useAiPlaylist'

export function StepProcessing({
  processing,
  onRetry,
}: {
  processing: ProcessingState | null
  onRetry: () => void
}) {
  if (!processing) return null
  const pct =
    processing.totalKeywords > 0
      ? Math.round((processing.doneKeywords / processing.totalKeywords) * 100)
      : 0
  const isSearch = processing.phase === 'searching'
  const isFilter = processing.phase === 'filtering'
  const isError = processing.phase === 'error'
  const isDone = processing.phase === 'done'

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
      <AnimatePresence mode="wait">
        {(isSearch || isFilter || isDone) && (
          <motion.div
            key={processing.phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-col items-center"
          >
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/15">
              {isSearch && <Search className="h-9 w-9 animate-pulse text-primary" />}
              {isFilter && <Loader2 className="h-9 w-9 animate-spin text-primary" />}
              {isDone && <CheckCircle2 className="h-9 w-9 text-primary" />}
            </div>
            <div className="mb-1 text-lg font-bold">{processing.message}</div>
            <div className="text-sm text-muted-foreground">
              {isSearch && '在多个音源中搜索真实歌曲'}
              {isFilter && `从 ${processing.foundSongs} 首里挑出好版本`}
              {isDone && '即将进入确认'}
            </div>
          </motion.div>
        )}
        {isError && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center"
          >
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-destructive/15">
              <AlertCircle className="h-9 w-9 text-destructive" />
            </div>
            <div className="mb-4 max-w-xs text-sm text-muted-foreground">{processing.message}</div>
            <button
              onClick={onRetry}
              className="touch-target flex items-center gap-1.5 rounded-2xl border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-accent"
            >
              <RotateCw className="h-4 w-4" /> 重试
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {(isSearch || isFilter) && (
        <div className="mt-6 w-full max-w-xs">
          <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{isSearch ? `${processing.hitKeywords}/${processing.totalKeywords} 命中` : ' '}</span>
            <span>{isSearch ? `${pct}%` : ' '}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-primary"
              animate={{ width: isSearch ? `${pct}%` : '100%' }}
              transition={{ ease: 'easeOut' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
