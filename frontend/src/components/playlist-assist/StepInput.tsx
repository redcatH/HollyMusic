import { Loader2, AlertCircle, Sparkles } from 'lucide-react'

const EXAMPLES = [
  '适合深夜学习的轻音乐，15首左右',
  '90年代经典华语情歌',
  '婚礼暖场欢快歌曲',
  '周杰伦风格的华语流行',
  '适合跑步的节奏感强的英文歌',
]

const COUNTS = [10, 15, 20, 30]

interface Props {
  prompt: string
  setPrompt: (v: string) => void
  targetCount: number
  setTargetCount: (v: number) => void
  generating: boolean
  generateError: string
  sources: string[]
  sourcesLoading: boolean
}

export function StepInput({
  prompt,
  setPrompt,
  targetCount,
  setTargetCount,
  generating,
  generateError,
  sources,
  sourcesLoading,
}: Props) {
  const noSources = !sourcesLoading && sources.length === 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">AI 帮你选歌</h2>
          <p className="mt-1.5 px-2 text-sm leading-relaxed text-muted-foreground">
            描述你想要的音乐，AI 生成候选、搜索、筛选，你来拍板。
          </p>
        </div>

        {/* 数量段控 */}
        <div className="mt-6">
          <div className="mb-2 text-xs font-medium text-muted-foreground">目标歌单数量</div>
          <div className="flex items-center gap-1 rounded-xl bg-muted/40 p-1">
            {COUNTS.map((c) => (
              <button
                key={c}
                onClick={() => setTargetCount(c)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  targetCount === c
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* 输入框 */}
        <div className="mt-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：适合深夜学习的轻音乐"
            rows={4}
            maxLength={500}
            className="w-full resize-none rounded-2xl bg-muted/40 px-4 py-3.5 text-base outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground/50 focus:bg-background focus:ring-primary"
          />
          <div className="mt-1.5 flex justify-end text-[11px] text-muted-foreground/60">
            {prompt.length}/500
          </div>
        </div>

        {/* 示例 */}
        <div className="mt-2">
          <div className="mb-2 text-xs font-medium text-muted-foreground">没思路？试试这些</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 transition hover:border-primary/50 hover:text-primary"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* 音源指示 */}
        <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          {sourcesLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> 加载音源…
            </>
          ) : noSources ? null : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              将从 {sources.length} 个启用音源搜索
            </>
          )}
        </div>

        {noSources && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>未启用任何音源，无法搜索。请联系管理员在后台启用音源。</span>
          </div>
        )}

        {generateError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{generateError}</span>
          </div>
        )}
      </div>
    </div>
  )
}
