import { useState } from 'react'
import { FileUp, Loader2, X } from 'lucide-react'
import { importNeteaseCsv } from '@/lib/api/playlists'

interface Props {
  onClose: () => void
  onImported: (playlistId: number) => void
}

export function ImportPlaylistDialog({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const submit = async () => {
    if (!file) { setError('请选择网易云 CSV 文件'); return }
    setBusy(true)
    setError(null)
    try {
      const data = await importNeteaseCsv(file, { name: name.trim() || undefined })
      setResult(`已导入 ${data.added} 首，重复 ${data.duplicates} 首，音质兜底 ${data.qualityFallback} 首`)
      onImported(data.playlistId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">导入网易云歌单 CSV</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">支持包含歌名、歌手和歌曲ID列的网易云导出文件。歌曲 ID 用于精确匹配和播放。</p>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="歌单名称（默认使用文件名）" className="mb-3 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm" />
        <label className="mb-4 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm hover:bg-accent/40">
          <FileUp className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate">{file?.name || '选择 CSV 文件'}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={event => setFile(event.target.files?.[0] || null)} />
        </label>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {result && <p className="mb-3 text-sm text-emerald-600">{result}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">取消</button>
          <button type="button" onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} 导入
          </button>
        </div>
      </div>
    </div>
  )
}
