import { useState } from 'react'
import { ListMusic, Plus, Sparkles } from 'lucide-react'
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

export function PlaylistsPage() {
  const { playlists, loading, create, rename, remove } = usePlaylists()
  const currentUsername = useAuthStore(s => s.username)
  const [showCreate, setShowCreate] = useState(false)
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
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="hidden text-2xl font-bold md:block">我的歌单</h1>
        <div className="flex items-center gap-2">
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
