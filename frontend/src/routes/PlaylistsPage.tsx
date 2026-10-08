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
    <div className="page-shell">
      <div className="mb-6 flex flex-col gap-4 border-b border-border/50 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title hidden desktop:block">我的歌单</h1>
          <p className="text-sm text-muted-foreground md:mt-2">把喜欢的旋律，收进自己的音乐角落。</p>
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

      {!loading && playlists.length > 0 && <p className="mb-3 text-xs text-muted-foreground">共 {playlists.length} 个歌单</p>}

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
