import { useRef, useState } from 'react'
import { CheckCircle2, FileCheck2, FileUp, Loader2, UploadCloud, X } from 'lucide-react'
import { importNeteaseCsv, importQqPlaylist } from '@/lib/api/playlists'

interface Props { onClose: () => void; onImported: (playlistId: number) => void }

export function ImportPlaylistDialog({ onClose, onImported }: Props) {
  const [source, setSource] = useState<'wy-csv' | 'tx'>('wy-csv')
  const [file, setFile] = useState<File | null>(null)
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const chooseFile = (candidate: File | undefined) => {
    setError(null); setResult(null)
    if (!candidate) return
    if (!candidate.name.toLowerCase().endsWith('.csv')) { setFile(null); setError('请选择 .csv 文件'); return }
    setFile(candidate)
    if (!name.trim()) setName(candidate.name.replace(/\.csv$/i, ''))
  }

  const submit = async () => {
    if (source === 'wy-csv' && !file) { setError('请选择网易云 CSV 文件'); return }
    if (source === 'tx' && !input.trim()) { setError('请输入 QQ 音乐公开歌单链接'); return }
    setBusy(true); setError(null)
    try {
      const data = source === 'wy-csv'
        ? await importNeteaseCsv(file!, { name: name.trim() || undefined })
        : await importQqPlaylist(input.trim(), name.trim() || undefined)
      setResult(`已导入 ${data.added} 首，重复 ${data.duplicates} 首，音质兜底 ${data.qualityFallback} 首`)
      onImported(data.playlistId)
    } catch (err) { setError(err instanceof Error ? err.message : '导入失败') } finally { setBusy(false) }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
    <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-6 py-5"><div><p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-primary">Playlist import</p><h2 className="text-xl font-semibold">导入外部歌单</h2></div><button type="button" onClick={onClose} aria-label="关闭" className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button></div>
      <div className="space-y-5 px-6 py-5">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-background p-1"><button type="button" onClick={() => { setSource('wy-csv'); setError(null) }} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${source === 'wy-csv' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>网易云 CSV</button><button type="button" onClick={() => { setSource('tx'); setError(null) }} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${source === 'tx' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>QQ 公开链接</button></div>
        <div className="flex items-start gap-3 rounded-xl bg-primary/8 p-3 text-sm text-muted-foreground"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>{source === 'wy-csv' ? 'CSV 中的网易云歌曲 ID 会用于精确匹配。系统会补全封面、专辑、时长和音质信息。' : '支持 QQ 音乐公开歌单链接或数字 ID。服务端分页获取完整歌曲列表，校验总数后再导入。'}</p></div>
        <div><label className="mb-2 block text-sm font-medium">歌单名称</label><input value={name} onChange={event => setName(event.target.value)} placeholder="默认使用来源歌单名称" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" /></div>
        {source === 'wy-csv' ? <div><label className="mb-2 block text-sm font-medium">CSV 文件</label><div onDragEnter={event => { event.preventDefault(); setDragging(true) }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]) }} onClick={() => inputRef.current?.click()} className={`cursor-pointer rounded-xl border border-dashed p-6 text-center transition ${dragging ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/60 hover:bg-accent/30'}`}><input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={event => chooseFile(event.target.files?.[0])} />{file ? <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" /> : <UploadCloud className="mx-auto mb-2 h-8 w-8 text-primary" />}<p className="truncate text-sm font-medium">{file?.name || '拖放 CSV 文件到这里'}</p><p className="mt-1 text-xs text-muted-foreground">或点击选择文件，最大支持 2MB</p></div></div> : <div><label className="mb-2 block text-sm font-medium">QQ 歌单链接或 ID</label><input value={input} onChange={event => setInput(event.target.value)} placeholder="https://y.qq.com/n/ryqq_v2/playlist/3043596225" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" /><p className="mt-2 text-xs text-muted-foreground">公开歌单无需登录。服务端分页校验后写入 tx-歌曲 MID。</p></div>}
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}{result && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">{result}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-background/40 px-6 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">取消</button><button type="button" onClick={() => void submit()} disabled={busy || (source === 'wy-csv' ? !file : !input.trim())} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} 导入</button></div>
    </div>
  </div>
}
