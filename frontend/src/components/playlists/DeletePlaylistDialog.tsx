import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  playlistName: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DeletePlaylistDialog({ playlistName, onClose, onConfirm }: Props) {
  const [submitting, setSubmitting] = useState(false)

  const confirmDelete = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl" onClick={event => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">删除歌单</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">确定删除歌单「{playlistName}」吗？</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
            取消
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={submitting}
            className="rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}
