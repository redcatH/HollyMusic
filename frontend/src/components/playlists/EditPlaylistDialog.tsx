import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  initialName: string
  onClose: () => void
  onSave: (name: string) => Promise<void>
}

export function EditPlaylistDialog({ initialName, onClose, onSave }: Props) {
  const [name, setName] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)
  const trimmedName = name.trim()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!trimmedName || submitting) return
    setSubmitting(true)
    try {
      await onSave(trimmedName)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl" onClick={event => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">编辑歌单</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit}>
          <input
            autoFocus
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="歌单名称"
            className="mb-4 w-full rounded-md bg-background px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-primary"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
              取消
            </button>
            <button
              type="submit"
              disabled={!trimmedName || submitting}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
