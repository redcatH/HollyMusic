import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Search, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { ProcessingState } from '@@/hooks/useAiPlaylist'

/**
 * 过渡态覆盖层内容（搜索/过滤中/出错）。
 * 不含底部按钮——按钮由壳的统一导航栏承载（错误态 right=重试，left=返回）。
 */
export function StepProcessing({ processing }: { processing: ProcessingState | null }) {
  if (!processing) return null
  const pct =
    processing.totalKeywords > 0
      ? Math.round((processing.doneKeywords / processing.totalKeywords) * 100)
      : 0
  const isSearch = processing.phase === 'searching'
  const isFilter = processing.phase === 'filtering'
  const isError = processing.phase === 'error'

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-8 text-center">
      <AnimatePresence mode="wait">
        {(isSearch || isFilter) && (
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
            </div>
            <div className="mb-1 text-lg font-bold">{processing.message}</div>
            <div className="text-sm text-muted-foreground">
              {isSearch && '在多个音源中搜索真实歌曲'}
              {isFilter && `从 ${processing.foundSongs} 首里挑出好版本`}
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
            <div className="mb-1 text-lg font-bold">处理失败</div>
            <div className="max-w-xs text-sm text-muted-foreground">{processing.message}</div>
            <div className="mt-2 text-xs text-muted-foreground">点底部「重试」或「返回修改候选」</div>
          </motion.div>
        )}
      </AnimatePresence>

      {(isSearch || isFilter) && (
        <div className="mt-6 w-full max-w-xs">
          <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{isSearch ? `${processing.hitKeywords}/${processing.totalKeywords} 命中` : ' '}</span>
            <span>{isSearch ? `${pct}%` : ' '}</span>
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

      {/* done 态短暂显示（正常会立即跳 Step2，此处兜底） */}
      {processing.phase === 'done' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center"
        >
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/15">
            <CheckCircle2 className="h-9 w-9 text-primary" />
          </div>
          <div className="text-lg font-bold">{processing.message}</div>
        </motion.div>
      )}
    </div>
  )
}
