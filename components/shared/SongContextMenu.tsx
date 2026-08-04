/**
 * 歌曲右键菜单（全局单例，由 context-menu-store 驱动）。
 *
 * 设计：
 * - 定位 fixed，边界检测靠右/下翻转
 * - outside-click（document mousedown）+ ESC 关闭
 * - 「加入歌单」自管 AddToPlaylistDialog，零回调透传
 * - 动作全部走 store action / 现有 hook，与 SongRow 一致
 */

import { useEffect, useRef, useState } from 'react'
import { Play, ListPlus, Plus, Heart, ListMusic, Download, Share2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { useAuthStore } from '@/hooks/useAuth'
import { useDownload } from '@/hooks/useDownload'
import { toast } from '@/lib/toast'
import { shareContent, buildSongShareUrl } from '@/lib/share'
import { AddToPlaylistDialog } from '../../frontend/src/components/playlists/AddToPlaylistDialog'
// ponytail: AddToPlaylistDialog 已移至 frontend/src/components/playlists，
// 根目录共享代码用相对路径引用 frontend 副本，确保 react-router context 与 BrowserRouter 同源，
// 避免双副本导致 context 为 null（黑屏 bug 根因）

const MENU_WIDTH = 192
const MENU_MAX_HEIGHT = 360

export function SongContextMenu() {
  const menu = useContextMenuStore(s => s.menu)
  const close = useContextMenuStore(s => s.close)
  const playTrack = usePlayerStore(s => s.playTrack)
  const addNext = usePlayerStore(s => s.addNext)
  const addToQueue = usePlayerStore(s => s.addToQueue)
  const uid = menu?.track.uid
  const isFav = useFavoritesStore(s => s.ids.has(uid ?? ''))
  const toggleFav = useFavoritesStore(s => s.toggle)
  const authenticated = useAuthStore(s => s.authenticated)
  const { download } = useDownload()
  const [playlistUid, setPlaylistUid] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, close])

  if (!menu) return null
  const { track, x, y } = menu
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8)

  const handleShare = () => {
    void shareContent({
      title: track.name,
      text: `${track.name} - ${track.artist}`,
      url: buildSongShareUrl(track.uid),
    })
    close()
  }

  return (
    <>
      <div
        ref={menuRef}
        className="fixed z-50 w-48 rounded-md border border-border bg-card p-1 shadow-lg"
        style={{ left, top }}
      >
        <MenuItem icon={Play} label="播放" onClick={() => { void playTrack(track); close() }} />
        <MenuItem icon={Plus} label="下一首播放" onClick={() => { addNext(track); toast.info('已加入下一首播放'); close() }} />
        <MenuItem icon={ListPlus} label="加入队列" onClick={() => { addToQueue(track); toast.info('已加入播放队列'); close() }} />
        <MenuItem
          icon={Heart}
          label={isFav ? '取消收藏' : '收藏'}
          onClick={() => { void toggleFav(track.uid).catch(() => {}); close() }}
        />
        <MenuItem icon={ListMusic} label="加入歌单" onClick={() => { setPlaylistUid(track.uid); close() }} />
        {authenticated && (
          <MenuItem icon={Download} label="下载" onClick={() => { download({ uid: track.uid }); close() }} />
        )}
        <MenuItem icon={Share2} label="分享" onClick={handleShare} />
      </div>
      {playlistUid && <AddToPlaylistDialog uid={playlistUid} onClose={() => setPlaylistUid(null)} />}
    </>
  )
}

function MenuItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  )
}
