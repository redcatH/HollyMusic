import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, FlaskConical, Loader2, Search, X } from 'lucide-react'
import { search } from '@/lib/api/search'
import { cancelSourceTest, commitSourceTest, discardSourceTest, getSourceTest, listSourceTests, loadTestSamples, runSourceTest, saveTestSamples, startSourceTest } from '@/lib/api/source-tests'
import { PLATFORM_NAMES, TEST_PLATFORMS, type SourceTestDraft, type TestSamples } from '@/lib/source-testing/types'
import type { Song, SourceType } from '@/lib/types/music'
import { usePlayerStore } from '@/lib/store/player-store'
import { ModalMask } from '@/components/shared/ModalMask'

const SECONDARY = 'rounded-full border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50'
const PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50'
const INPUT = 'w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary'
const STATUS_NAMES = { waiting: '等待', running: '检测中', passed: '通过', warning: '需确认', failed: '失败', cancelled: '已停止' }
const QUALITY_NAMES = { flac24bit: '24 bit FLAC', flac: 'FLAC', '320k': '320k', '128k': '128k' }
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请稍后重试'

function TestModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), audio, [tabindex="0"]')
      if (!controls?.length) return
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [])
  return <ModalMask onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl outline-none sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-lg font-semibold"><FlaskConical className="h-5 w-5 text-primary" />{title}</h3><button type="button" aria-label="关闭测试窗口" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-accent"><X className="h-5 w-5" /></button></div>
      {children}
    </div>
  </ModalMask>
}

export function TestSongSettings({ onChange }: { onChange?: (samples: TestSamples) => void }) {
  const [samples, setSamples] = useState<TestSamples>({})
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<SourceType | null>(null)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<Song[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let alive = true
    loadTestSamples().then(value => { if (alive) { setSamples(value); onChange?.(value) } }, error => { if (alive) setError(errorText(error)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; request.current?.abort() }
  }, [onChange])
  const choosePlatform = (next: SourceType) => {
    request.current?.abort(); setSearching(false); setPlatform(next); setKeyword(''); setResults([]); setError('')
  }
  useEffect(() => { if (platform) searchInput.current?.focus() }, [platform])
  const save = async (next: TestSamples) => {
    if (saving) return
    setSaving(true); setError('')
    try { const stored = await saveTestSamples(next); setSamples(stored); onChange?.(stored); setPlatform(null) }
    catch (error) { setError(errorText(error)) }
    finally { setSaving(false) }
  }
  const find = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!platform || !keyword.trim()) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setSearching(true); setError('')
    try {
      const response = await search(platform, keyword.trim(), 1, 20, controller.signal)
      if (!controller.signal.aborted) { setResults(response.list); if (!response.list.length) setError('没有找到歌曲，请换个关键词') }
    } catch (error) { if (!controller.signal.aborted) setError(errorText(error)) }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">每个平台保存一首歌曲，所有音源共用。验证 VIP 能力时，请选择已知的 VIP 歌曲。</p>
    {loading ? <p className="text-sm text-muted-foreground">加载测试歌曲…</p> : <div className="grid gap-2 sm:grid-cols-2">
      {TEST_PLATFORMS.map(p => <div key={p} className="flex items-center gap-3 rounded-lg border border-border p-3">
        <span className="w-10 shrink-0 text-sm font-medium">{PLATFORM_NAMES[p]}</span><div className="min-w-0 flex-1"><p className="truncate text-sm">{samples[p]?.name || '未设置测试歌曲'}</p><p className="truncate text-xs text-muted-foreground">{samples[p] ? `${samples[p]!.singer} · ${samples[p]!.interval}` : '该平台将标记为未测试'}</p></div>
        <button type="button" disabled={saving} onClick={() => choosePlatform(p)} className="text-xs text-primary hover:underline">{samples[p] ? '更换' : '选择'}</button>
        {samples[p] && <button type="button" disabled={saving} aria-label={`清除${PLATFORM_NAMES[p]}测试歌曲`} onClick={() => { const next = { ...samples }; delete next[p]; void save(next) }} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
      </div>)}
    </div>}
    {platform && <div className="rounded-lg bg-accent/30 p-3">
      <form onSubmit={find} className="flex gap-2"><label className="min-w-0 flex-1"><span className="mb-2 block text-xs text-muted-foreground">选择{PLATFORM_NAMES[platform]}测试歌曲</span><input ref={searchInput} aria-label="搜索测试歌曲" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索歌名或歌手" className={INPUT} /></label><button type="submit" disabled={searching || !keyword.trim()} className={`${PRIMARY} self-end`}>{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}搜索</button></form>
      <div className="mt-3 max-h-56 overflow-y-auto">{results.map(song => <button type="button" key={song.uid} disabled={saving} onClick={() => void save({ ...samples, [platform]: song })} className="flex w-full items-center justify-between gap-3 rounded-md p-2 text-left hover:bg-accent disabled:opacity-50"><div className="min-w-0"><p className="truncate text-sm">{song.name}</p><p className="truncate text-xs text-muted-foreground">{song.singer} · {song.albumName} · {song.interval}</p></div><span className="shrink-0 text-xs text-primary">选用</span></button>)}</div>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}

export function TestSongSettingsDialog({ onClose }: { onClose: () => void }) {
  return <TestModal title="测试歌曲" onClose={onClose}><TestSongSettings /></TestModal>
}

export function SourceTestHistory({ onClose, onSelect }: { onClose: () => void; onSelect: (draft: SourceTestDraft) => void }) {
  const [drafts, setDrafts] = useState<SourceTestDraft[]>([])
  const [pending, setPending] = useState<SourceTestDraft[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { let alive = true; listSourceTests().then(value => { if (alive) { setDrafts(value.list); setPending(value.pending || []) } }, error => { if (alive) setError(errorText(error)) }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [])
  return <TestModal title="最近测试" onClose={onClose}><div className="space-y-4">
    {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {pending.length > 0 && <section aria-label="待处理音源" className="space-y-2"><h4 className="text-sm font-medium">待处理音源</h4>{pending.map(draft => <button type="button" key={draft.id} onClick={() => onSelect(draft)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-4 text-left hover:bg-accent"><div><p className="text-sm font-medium">{draft.name}</p><p className="mt-1 text-xs text-muted-foreground">未测试 · {draft.kind === 'update' ? '订阅更新' : draft.kind === 'subscription' ? '订阅音源' : '上传音源'}</p></div><span className="shrink-0 text-xs text-primary">继续处理</span></button>)}</section>}
    <section aria-label="测试记录" className="space-y-2">{pending.length > 0 && <h4 className="text-sm font-medium">测试记录</h4>}{!loading && !error && !drafts.length && <p className="py-8 text-center text-muted-foreground">暂无测试记录</p>}{drafts.map(draft => <button type="button" key={draft.id} onClick={() => onSelect(draft)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-4 text-left hover:bg-accent"><div><p className="text-sm font-medium">{draft.name}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(draft.startedAt || draft.createdAt).toLocaleString()} · {draft.results.filter(item => item.status === 'passed').length}/{draft.results.length} 项通过</p></div><span className="shrink-0 text-xs text-primary">{draft.status === 'running' ? '查看进度' : '查看报告'}</span></button>)}</section>
  </div></TestModal>
}

export function SourceTestDialog({ initialDraft, onClose, onCommitted }: { initialDraft: SourceTestDraft; onClose: () => void; onCommitted: () => Promise<void> }) {
  const [draft, setDraft] = useState(initialDraft)
  const [samples, setSamples] = useState<TestSamples>({})
  const [showSongs, setShowSongs] = useState(false)
  const [platforms, setPlatforms] = useState<string[]>(initialDraft.target ? (initialDraft.target.pt?.length ? initialDraft.target.pt.filter(p => Object.hasOwn(initialDraft.capabilities, p)) : Object.keys(initialDraft.capabilities)) : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [playback, setPlayback] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const audio = useRef<HTMLAudioElement>(null)
  const busyRef = useRef(false)
  const running = draft.status === 'running'
  const committed = draft.status === 'committed'
  const unstartedPreview = draft.persisted === false
  const expired = Date.parse(draft.expiresAt) < now
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const updateSamples = useCallback((value: TestSamples) => setSamples(value), [])
  useEffect(() => { let alive = true; loadTestSamples().then(value => { if (alive) setSamples(value) }, error => { if (alive) setError(errorText(error)) }); return () => { alive = false } }, [])
  useEffect(() => {
    if (!running) return
    let alive = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { const current = await getSourceTest(draft.id); if (alive) { setDraft(current); setError('') } }
      catch (error) { if (alive) setError(errorText(error)) }
      if (alive) timer = setTimeout(poll, 1500)
    }
    timer = setTimeout(poll, 1000)
    return () => { alive = false; clearTimeout(timer) }
  }, [running, draft.id])
  const action = async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await work() } catch (error) { setError(errorText(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const run = (mode: 'quick' | 'full', keys?: string[]) => action(async () => {
    audio.current?.pause(); setPreview(null)
    setDraft(await (unstartedPreview ? startSourceTest(draft.target!.path, draft.hash, mode, keys) : runSourceTest(draft.id, mode, keys)))
  })
  const save = (enabled: boolean) => action(async () => { await commitSourceTest(draft.id, platforms, enabled); await onCommitted(); onClose() })
  const done = draft.results.filter(item => !['waiting', 'running'].includes(item.status)).length
  const failed = draft.results.filter(item => item.status === 'failed').map(item => item.key)
  const available = Object.keys(draft.capabilities) as SourceType[]
  const hasSamples = available.some(p => samples[p])
  return <TestModal title={draft.kind === 'update' ? '测试订阅新版本' : draft.kind === 'retest' ? '测试音源' : '测试并导入音源'} onClose={onClose}>
    <div className="space-y-5">
      <div className="rounded-lg bg-accent/30 p-3"><p className="font-medium">{draft.name}</p><p className="mt-1 text-xs text-muted-foreground">{draft.kind === 'update' ? (draft.unchanged ? '订阅内容未变化，可以重新检查当前版本。' : '正在测试候选版本，确认更新后才替换当前音源。') : '使用各平台已保存的歌曲，逐项检测音源声明的音质。'}</p></div>
      <div><div className="flex items-center justify-between"><p className="text-sm font-medium">测试歌曲</p><button type="button" disabled={running || busy} onClick={() => setShowSongs(value => !value)} className="text-sm text-primary hover:underline">{showSongs ? '收起' : '设置歌曲'}</button></div>
        {showSongs ? <div className="mt-3"><TestSongSettings onChange={updateSamples} /></div> : <div className="mt-2 flex flex-wrap gap-2">{available.map(p => <span key={p} className="rounded-md border border-border px-2 py-1 text-xs">{PLATFORM_NAMES[p]} · {samples[p]?.name || '未设置，跳过'}</span>)}</div>}
        {draft.samplesChanged && <p className="mt-2 text-xs text-amber-600">歌曲设置已变更，下方报告使用之前的歌曲，请重新测试。</p>}
      </div>
      {!committed && <div className="flex flex-wrap items-center gap-2">
        {running ? <><Loader2 className="h-4 w-4 animate-spin text-primary" /><span aria-live="polite" className="text-sm">已完成 {done}/{draft.results.length} 项</span><button type="button" disabled={busy} onClick={() => void action(async () => { await cancelSourceTest(draft.id); setDraft(await getSourceTest(draft.id)) })} className={`${SECONDARY} ml-auto`}>停止测试</button></> : <>
          <button type="button" disabled={busy || !hasSamples || expired} onClick={() => void run('quick')} className={PRIMARY}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}{draft.results.length ? '重新测试' : '开始测试'}</button>
          <button type="button" disabled={busy || !hasSamples || expired} onClick={() => void run('full')} className={SECONDARY}>完整检查</button>
          {failed.length > 0 && <button type="button" disabled={busy || expired} onClick={() => void run('quick', failed)} className={SECONDARY}>重试失败项</button>}
          {!hasSamples && <button type="button" onClick={() => setShowSongs(true)} className="text-sm text-primary">先选择测试歌曲</button>}
        </>}
      </div>}
      {draft.results.length > 0 && <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-left text-sm"><thead className="bg-accent/40 text-xs text-muted-foreground"><tr><th className="px-3 py-3">平台 / 音质</th><th className="px-3 py-3">检测结果</th><th className="px-3 py-3">实际音频</th><th className="px-3 py-3">操作</th></tr></thead><tbody>{draft.results.map(item => <tr key={item.key} className="border-t border-border align-top">
        <td className="whitespace-nowrap px-3 py-3"><p>{PLATFORM_NAMES[item.platform]}</p><p className="mt-1 text-xs text-muted-foreground">{QUALITY_NAMES[item.quality]}</p></td>
        <td className="min-w-44 px-3 py-3"><span className={`rounded px-1.5 py-0.5 text-xs ${item.status === 'passed' ? 'bg-green-500/15 text-green-600' : item.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{STATUS_NAMES[item.status]}</span><p className="mt-2 text-xs">{item.message}</p><p className="mt-1 text-xs text-muted-foreground">{item.song.name} · {item.song.interval}{item.elapsedMs ? ` · ${(item.elapsedMs / 1000).toFixed(1)}s` : ''}</p></td>
        <td className="min-w-32 px-3 py-3 text-xs text-muted-foreground">{item.facts ? <><p>{item.facts.codec}</p><p className="mt-1">{item.facts.sampleRate ? `${item.facts.sampleRate / 1000} kHz` : ''}{item.facts.bitsPerSample ? ` / ${item.facts.bitsPerSample} bit` : ''}</p><p className="mt-1">{item.facts.duration ? `${Math.round(item.facts.duration)} 秒` : '时长未知'}{item.bytes ? ` · ${(item.bytes / 1048576).toFixed(1)} MB` : ''}</p><p className="mt-1">{item.complete ? '已下载完整文件' : '仅检查部分数据'}</p></> : '—'}</td>
        <td className="whitespace-nowrap px-3 py-3"><div className="flex flex-col items-start gap-2">{item.asset && !expired && <button type="button" onClick={() => { setPreview(item.key); setPlayback('') }} className="text-xs text-primary">试听</button>}{!running && !committed && !expired && <button type="button" disabled={busy} onClick={() => void run('full', [item.key])} className="text-xs text-primary">完整检查</button>}</div></td>
      </tr>)}</tbody></table></div>}
      {draft.kind === 'update' && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">与旧版本比较</summary>{draft.previousReport ? <div className="mt-3 space-y-2 text-xs text-muted-foreground"><p>旧报告时间：{new Date(draft.previousReport.createdAt).toLocaleString()}。不同歌曲或检查模式的结果不作直接比较。</p>{TEST_PLATFORMS.filter(p => draft.capabilities[p] || draft.previousReport!.capabilities[p]).map(p => <div key={p} className="grid grid-cols-3 gap-2 border-t border-border pt-2"><span>{PLATFORM_NAMES[p]}</span><span>旧：{draft.previousReport!.capabilities[p]?.map(q => QUALITY_NAMES[q]).join(' / ') || '未声明'}</span><span>新：{draft.capabilities[p]?.map(q => QUALITY_NAMES[q]).join(' / ') || '未声明'}</span></div>)}<p>旧版本通过 {draft.previousReport.results.filter(item => item.status === 'passed').length}/{draft.previousReport.results.length} 项；候选版本通过 {draft.results.filter(item => item.status === 'passed').length}/{draft.results.length} 项。</p></div> : <p className="mt-2 text-xs text-muted-foreground">暂无与当前旧版本匹配的测试报告。可以先复测当前音源，再拉取订阅新版本进行比较。</p>}</details>}
      {preview && <div className="rounded-lg bg-accent/30 p-3"><div className="mb-2 flex items-center justify-between text-xs"><span>试听本次检测的音频 · {PLATFORM_NAMES[preview.split(':')[0] as SourceType]}</span><button type="button" onClick={() => { audio.current?.pause(); setPreview(null) }} aria-label="关闭试听"><X className="h-4 w-4" /></button></div><audio ref={audio} controls autoPlay key={preview} src={`/api/admin/source-tests/${draft.id}/audio?key=${encodeURIComponent(preview)}`} onPlay={() => { usePlayerStore.getState().setIsPlaying(false); setPlayback('当前浏览器播放正常，仅验证已播放部分') }} onCanPlay={() => setPlayback('浏览器已能加载音频，请播放确认歌曲是否正确')} onError={() => setPlayback('当前浏览器无法播放此音频；可尝试完整检查后再试听')} className="h-10 w-full" />{playback && <p className="mt-2 text-xs text-muted-foreground">{playback}</p>}</div>}
      <p className="text-xs text-muted-foreground">快速测试最多读取 1MB，完整检查每项最多 64MB。FLAC 编码确认不代表原生无损认证；单首歌曲的结果仅代表本次样本。</p>
      {!committed && <div className="border-t border-border pt-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">启用平台</p><button type="button" disabled={running || busy} onClick={() => setPlatforms([...new Set(draft.results.filter(item => item.status === 'passed').map(item => item.platform))])} className="text-xs text-primary">勾选通过的平台</button></div>
        <div className="flex flex-wrap gap-2">{available.map(p => <label key={p} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm ${platforms.includes(p) ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}><input type="checkbox" disabled={running || busy || expired} checked={platforms.includes(p)} onChange={() => setPlatforms(previous => previous.includes(p) ? previous.filter(value => value !== p) : [...previous, p])} className="accent-primary" />{PLATFORM_NAMES[p]}</label>)}</div>
        <p className="mt-2 text-xs text-muted-foreground">检测结果仅供参考，由你决定实际启用的平台。</p>
      </div>}
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {expired && !committed && <p className="text-sm text-amber-600">候选已过期，请重新上传或拉取订阅。</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {!running && !unstartedPreview && <button type="button" disabled={busy} onClick={() => void action(async () => { await discardSourceTest(draft.id); onClose() })} className="mr-auto text-sm text-muted-foreground hover:text-destructive">{committed ? '删除报告' : '放弃候选'}</button>}
        <button type="button" onClick={onClose} className={SECONDARY}>{running ? '后台继续' : committed || unstartedPreview ? '关闭' : '稍后处理'}</button>
        {!committed && !unstartedPreview && <><button type="button" disabled={busy || running || expired} onClick={() => void save(false)} className={SECONDARY}>{draft.kind === 'retest' ? '保存并停用' : '仅保存为停用'}</button><button type="button" disabled={busy || running || expired || !platforms.length || !draft.results.some(item => ['passed', 'warning'].includes(item.status))} onClick={() => void save(draft.target ? draft.target.enabled : true)} className={PRIMARY}><CheckCircle2 className="h-4 w-4" />{draft.kind === 'update' ? '确认更新' : draft.kind === 'retest' ? '应用平台选择' : '导入并启用'}</button></>}
      </div>
    </div>
  </TestModal>
}
