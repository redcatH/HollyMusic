import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePlaylistDetail } from '@/hooks/usePlaylistDetail'
import { useAuthStore } from '@/hooks/useAuth'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Play, Trash2, Music, Share2, Sparkles, MoreHorizontal, Pencil } from 'lucide-react'
import { usePlayerStore } from '@/lib/store/player-store'
import { shareContent, buildPlaylistShareUrl } from '@/lib/share'
import { toTrack, type Track } from '@/lib/types/player'
import { deletePlaylist, updatePlaylist } from '@/lib/api/playlists'
import { DeletePlaylistDialog } from '@@/components/playlists/DeletePlaylistDialog'
import { EditPlaylistDialog } from '@@/components/playlists/EditPlaylistDialog'
import { PlaylistCover } from '@@/components/playlists/PlaylistCover'

export function PlaylistDetailPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const id = parseInt(idStr ?? '0', 10)
  const { detail, loading, reload } = usePlaylistDetail(id)
  const playTrack = usePlayerStore(s => s.playTrack)
  const currentUsername = useAuthStore(s => s.username)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const tracks: Track[] = (detail?.entries ?? [])
    .filter(e => e.musicInfo)
    .map(e => toTrack({ uid: e.songId, musicInfo: e.musicInfo! }))

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const handleEdit = async (name: string) => {
    try {
      await updatePlaylist(id, { name })
      setShowEdit(false)
      await reload()
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存失败')
    }
  }

  const handleDelete = async () => {
    try {
      await deletePlaylist(id)
      navigate('/playlists')
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除失败')
    }
  }

  return (
    <div className="p-6">
      {loading ? (
        <LoadingSkeleton />
      ) : !detail ? (
        <EmptyState icon={Music} title="歌单不存在" />
      ) : (
        <>
          <div className="mb-6 flex items-end gap-4">
            <PlaylistCover
              coverArt={detail.coverArt}
              coverSongUid={detail.coverSongUid}
              className="h-32 w-32 shrink-0"
            />
            <div className="flex-1">
              <h1 className="text-3xl font-bold">{detail.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {detail.songCount} 首 · {detail.username}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => tracks.length > 0 && playTrack(tracks[0], tracks)}
                  disabled={tracks.length === 0}
                  className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4 fill-current" /> 播放全部
                </button>
                <button
                  onClick={() => navigate(`/playlists/${id}/ai-add`)}
                  className="flex items-center gap-1 rounded-full bg-primary/15 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/25"
                >
                  <Sparkles className="h-4 w-4" /> AI 加歌
                </button>
                <button
                  onClick={() =>
                    shareContent({
                      title: detail.name,
                      text: `歌单：${detail.name}`,
                      url: buildPlaylistShareUrl(id),
                    })
                  }
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <Share2 className="h-4 w-4" /> 分享歌单
                </button>
                {detail.username === currentUsername && (
                  <div ref={menuRef} className="relative">
                    <button
                      type="button"
                      aria-label="更多歌单操作"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen(open => !open)}
                      className="flex h-full items-center justify-center rounded-full border border-border px-3 py-2 text-muted-foreground hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuOpen && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-28 rounded-md border border-border bg-popover p-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false)
                            setShowEdit(true)
                          }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          <Pencil className="h-3.5 w-3.5" /> 编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false)
                            setShowDelete(true)
                          }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 删除
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {tracks.length > 0 ? (
            <SongList tracks={tracks} />
          ) : (
            <EmptyState icon={Music} title="歌单为空" description="去搜索并添加歌曲" />
          )}
        </>
      )}

      {detail && showEdit && (
        <EditPlaylistDialog
          initialName={detail.name}
          onClose={() => setShowEdit(false)}
          onSave={handleEdit}
        />
      )}

      {detail && showDelete && (
        <DeletePlaylistDialog
          playlistName={detail.name}
          onClose={() => setShowDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
