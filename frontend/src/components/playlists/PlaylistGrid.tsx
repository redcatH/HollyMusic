
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PlaylistSummary } from '@/lib/api/playlists'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { PlaylistCover } from './PlaylistCover'

interface Props {
  playlists: PlaylistSummary[]
  currentUsername: string | null
  onEdit: (playlist: PlaylistSummary) => void
  onDelete: (playlist: PlaylistSummary) => void
}

export function PlaylistGrid({ playlists, currentUsername, onEdit, onDelete }: Props) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!gridRef.current?.contains(event.target as Node)) setOpenMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  return (
    <div ref={gridRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {playlists.map(playlist => (
        <div key={playlist.id} className="group relative rounded-lg p-2 hover:bg-accent/40">
          <Link to={`/playlists/${playlist.id}`} className="flex flex-col gap-2">
            <PlaylistCover
              coverArt={playlist.coverArt}
              coverSongUid={playlist.coverSongUid}
              className="aspect-square w-full"
            />
            <div className="truncate text-sm font-medium">{playlist.name}</div>
            <div className="pr-8 text-xs text-muted-foreground">{playlist.songCount} 首</div>
          </Link>

          {playlist.username === currentUsername && (
            <>
              <button
                type="button"
                aria-label={`操作歌单：${playlist.name}`}
                aria-expanded={openMenuId === playlist.id}
                onClick={() => setOpenMenuId(id => id === playlist.id ? null : playlist.id)}
                className="absolute bottom-2 right-2 rounded p-1 text-muted-foreground opacity-100 transition hover:bg-accent hover:text-foreground sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>

              {openMenuId === playlist.id && (
                <div className="absolute bottom-9 right-2 z-10 w-28 rounded-md border border-border bg-popover p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null)
                      onEdit(playlist)
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null)
                      onDelete(playlist)
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}
