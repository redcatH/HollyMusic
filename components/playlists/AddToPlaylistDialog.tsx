'use client'

import { useEffect, useState } from 'react'
import {
  listPlaylists,
  createPlaylist,
  addSongsToPlaylist,
  type PlaylistSummary,
} from '@/lib/api/playlists'
import { X, Plus, Check } from 'lucide-react'
import { CreatePlaylistDialog } from './CreatePlaylistDialog'

interface Props {
  uid: string
  onClose: () => void
}

export function AddToPlaylistDialog({ uid, onClose }: Props) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [addedId, setAddedId] = useState<number | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const { list } = await listPlaylists()
      setPlaylists(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const handleAdd = async (pl: PlaylistSummary) => {
    try {
      await addSongsToPlaylist(pl.id, [uid])
      setAddedId(pl.id)
      setTimeout(onClose, 700)
    } catch (e) {
      alert(e instanceof Error ? e.message : '添加失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">添加到歌单</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="mb-2 flex w-full items-center gap-2 rounded-md p-2 text-sm font-medium text-primary hover:bg-accent"
        >
          <Plus className="h-4 w-4" /> 新建歌单
        </button>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">加载中...</div>
          ) : playlists.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">暂无歌单</div>
          ) : (
            playlists.map(pl => (
              <button
                key={pl.id}
                onClick={() => handleAdd(pl)}
                className="flex w-full items-center justify-between rounded-md p-2 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{pl.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {pl.songCount} 首
                  {addedId === pl.id && <Check className="h-3 w-3 text-primary" />}
                </span>
              </button>
            ))
          )}
        </div>

        {showCreate && (
          <CreatePlaylistDialog
            onClose={() => setShowCreate(false)}
            onCreate={async name => {
              await createPlaylist(name)
              await reload()
              setShowCreate(false)
            }}
          />
        )}
      </div>
    </div>
  )
}
