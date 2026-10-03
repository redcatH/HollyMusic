import { useState } from 'react'
import { FileUp, ListMusic, Plus, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { PlaylistSummary } from '@/lib/api/playlists'
import { useAuthStore } from '@/hooks/useAuth'
import { usePlaylists } from '@/hooks/usePlaylists'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { CreatePlaylistDialog } from '@@/components/playlists/CreatePlaylistDialog'
import { DeletePlaylistDialog } from '@@/components/playlists/DeletePlaylistDialog'
import { EditPlaylistDialog } from '@@/components/playlists/EditPlaylistDialog'
import { PlaylistGrid } from '@@/components/playlists/PlaylistGrid'
import { ImportPlaylistDialog } from '@@/components/playlists/ImportPlaylistDialog'

export function PlaylistsPage() {
  const { playlists, loading, create, rename, remove } = usePlaylists()
  const currentUsername = useAuthStore(s => s.username)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingPlaylist, setEditingPlaylist] = useState<PlaylistSummary | null>(null)
  const [deletingPlaylist, setDeletingPlaylist] = useState<PlaylistSummary | null>(null)
  const navigate = useNavigate()

  const handleRename = async (name: string) => {
    if (!editingPlaylist) return
    try {
      await rename(editingPlaylist.id, name)
      setEditingPlaylist(null)
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存失败')
    }
  }

  const handleDelete = async () => {
    if (!deletingPlaylist) return
    try {
      await remove(deletingPlaylist.id)
      setDeletingPlaylist(null)
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除失败')
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-primary">Your library</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">我的歌单</h1>
          <p className="mt-1 text-sm text-muted-foreground">整理收藏，导入外部歌单，随时开始播放。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            <FileUp className="h-4 w-4" /> 导入
          </button>
          <button
            onClick={() => navigate('/playlists/ai-create')}
            className="flex items-center gap-1 rounded-full bg-primary/15 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/25"
          >
            <Sparkles className="h-4 w-4" /> AI 建歌单
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> 新建
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton count={4} />
      ) : playlists.length > 0 ? (
        <PlaylistGrid
          playlists={playlists}
          currentUsername={currentUsername}
          onEdit={setEditingPlaylist}
          onDelete={setDeletingPlaylist}
        />
      ) : (
        <EmptyState icon={ListMusic} title="还没有歌单" description="新建一个歌单开始整理" />
      )}

      {showCreate && (
        <CreatePlaylistDialog
          onClose={() => setShowCreate(false)}
          onCreate={async name => {
            await create(name)
            setShowCreate(false)
          }}
        />
      )}

      {showImport && (
        <ImportPlaylistDialog
          onClose={() => setShowImport(false)}
          onImported={playlistId => {
            setShowImport(false)
            navigate(`/playlists/${playlistId}`)
          }}
        />
      )}

      {editingPlaylist && (
        <EditPlaylistDialog
          initialName={editingPlaylist.name}
          onClose={() => setEditingPlaylist(null)}
          onSave={handleRename}
        />
      )}

      {deletingPlaylist && (
        <DeletePlaylistDialog
          playlistName={deletingPlaylist.name}
          onClose={() => setDeletingPlaylist(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
