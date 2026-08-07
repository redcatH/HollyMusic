import { Loader2, AlertCircle, Sparkles } from 'lucide-react'

const EXAMPLES = [
  '适合深夜学习的轻音乐，15首左右',
  '90年代经典华语情歌',
  '婚礼暖场欢快歌曲',
  '周杰伦风格的华语流行',
  '适合跑步的节奏感强的英文歌',
]

const COUNTS = [10, 15, 20, 30]

const SOURCE_LABELS: Record<string, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ音乐',
  wy: '网易云',
  mg: '咪咕',
}

interface Props {
  prompt: string
  setPrompt: (v: string) => void
  targetCount: number
  setTargetCount: (v: number) => void
  generating: boolean
  generateError: string
  sources: string[]
  sourcesLoading: boolean
  selectedSources: string[]
  toggleSource: (src: string) => void
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
  selectedSources,
  toggleSource,
}: Props) {
  const noSources = !sourcesLoading && sources.length === 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-lg font-bold tracking-tight">AI 帮你选歌</h2>
          <p className="mt-1 px-2 text-xs leading-relaxed text-muted-foreground">
            描述你想要的音乐，AI 生成候选并搜索，你来拍板。
          </p>
        </div>

        {/* 主体：≥768px(PC) 双栏（核心交互 | 示例），<768px(手机) 单栏堆叠。断点与 AiPlaylistPage 一致 */}
        <div className="md:mt-4 md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-6">
          {/* 左栏：核心交互 */}
          <div className="mt-3 md:mt-0">
            {/* 数量段控 */}
            <div>
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

            {/* 搜索音源（可取消，至少保留 1 个）——放输入框上方，避免手机键盘弹出时被遮挡 */}
            <div className="mt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {sourcesLoading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> 加载音源…
                  </span>
                ) : (
                  '搜索音源（点按取消，至少保留 1 个）'
                )}
              </div>
              {!sourcesLoading && sources.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {sources.map((src) => {
                      const selected = selectedSources.includes(src)
                      const cantDeselect = selected && selectedSources.length <= 1
                      return (
                        <button
                          key={src}
                          onClick={() => toggleSource(src)}
                          disabled={cantDeselect}
                          className={`touch-target rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            selected
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground line-through opacity-50 hover:border-primary/40 hover:opacity-80'
                          } ${cantDeselect ? 'cursor-not-allowed' : ''}`}
                        >
                          {SOURCE_LABELS[src] || src}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    将从 {selectedSources.length}/{sources.length} 个音源搜索
                  </div>
                </>
              )}
            </div>

            {/* 输入框 */}
            <div className="mt-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例如：适合深夜学习的轻音乐"
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded-2xl bg-muted/40 px-4 py-3.5 text-base outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground/50 focus:bg-background focus:ring-primary"
              />
              <div className="mt-1.5 flex justify-end text-[11px] text-muted-foreground/60">
                {prompt.length}/500
              </div>
            </div>
          </div>

          {/* 右栏：示例（PC 独占一栏；手机回到主流程下方单栏） */}
          <div className="mt-2 md:mt-0 md:border-l md:border-border md:pl-6">
            <div className="mb-2 text-xs font-medium text-muted-foreground">没思路？试试这些</div>
            <div className="flex flex-wrap gap-2 md:flex-col md:items-stretch">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs text-foreground/80 transition hover:border-primary/50 hover:text-primary md:rounded-xl md:py-2"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
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
