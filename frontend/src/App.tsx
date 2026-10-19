/**
 * SPA 根布局。
 *
 * 替代 Next.js app-router 的 app/layout.tsx + AppShell.tsx。
 * react-router 的 navigate() 同步更新 URL，组件立即切换——无需 pendingPath/activePath。
 */

import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar, MobileSidebar } from './components/Layout'
import { MobileHeader } from './components/MobileHeader'
import { PlayerBar } from '@/components/player/PlayerBar'
import { QueuePanel } from '@/components/player/QueuePanel'
import { LyricsPanel } from '@/components/player/LyricsPanel'
import { ToastContainer } from '@/components/toast/ToastContainer'
import { SongContextMenu } from '@/components/shared/SongContextMenu'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { usePlayerStore } from '@/lib/store/player-store'
import { useSearchStore } from '@/lib/store/search-store'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { useAuthStore } from '@/hooks/useAuth'
import { usePlayerPersistence } from '@/hooks/usePlayerPersistence'
import { LyricsPanelContext } from '@/hooks/useLyricsPanel'
import { useLyricsHistory } from './hooks/useLyricsHistory'
import { CachedHomePage } from './components/CachedHomePage'
import { DiscoveryCollectionPage } from './routes/DiscoveryCollectionPage'
import { RecommendedMusicPage } from './routes/RecommendedMusicPage'
import { SearchPage } from './routes/SearchPage'
import { FavoritesPage } from './routes/FavoritesPage'
import { PlaylistsPage } from './routes/PlaylistsPage'
import { PlaylistDetailPage } from './routes/PlaylistDetailPage'
import { AiPlaylistPage } from './routes/AiPlaylistPage'
import { HistoryPage } from './routes/HistoryPage'
import { AdminPage, AdminUsersPage, AdminSourcesPage, AdminRecommendPage } from './routes/AdminPage'
import { OfflinePage } from './routes/OfflinePage'
import { LoginPage } from './routes/LoginPage'
import { SetupPage } from './routes/SetupPage'
import { AuthLayout } from './components/AuthLayout'
import { ChangePasswordPage } from './routes/ChangePasswordPage'
import { EqualizerPage } from './routes/EqualizerPage'

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const initAuth = useAuthStore(s => s.init)
  const authenticated = useAuthStore(s => s.authenticated)
  const mustChangePassword = useAuthStore(s => s.mustChangePassword)
  const setupRequired = useAuthStore(s => s.setupRequired)
  const authError = useAuthStore(s => s.error)
  const offlineUsername = useAuthStore(s => s.offlineUsername)
  const username = useAuthStore(s => s.username)
  const loadFavorites = useFavoritesStore(s => s.load)
  const playByUid = usePlayerStore(s => s.playByUid)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 播放引擎只创建一张原生 Audio；传给底栏与歌词详情共用同一分析对象。
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const playbackReady = usePlayerPersistence()
  const autoPlayRef = useRef(false)
  const lyricsPanel = useLyricsHistory(playbackReady)

  // 包括浏览器前进/后退；强制关闭，避免刚打开菜单时的 close 保护期。
  useEffect(() => {
    useContextMenuStore.getState().dismiss()
  }, [location])

  // 启动时获取会话状态
  useEffect(() => {
    initAuth()
  }, [initAuth])

  useEffect(() => {
    const reconnect = () => { void initAuth() }
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', reconnect)
    return () => {
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', reconnect)
    }
  }, [initAuth])

  // 登录后才加载收藏
  useEffect(() => {
    if (authenticated === true) {
      loadFavorites()
    }
  }, [authenticated, loadFavorites])

  // 登出/会话失效 → 清空上一个用户的播放器、收藏、搜索等残留状态
  useEffect(() => {
    if (authenticated !== false) return
    useContextMenuStore.getState().dismiss()
    const p = usePlayerStore.getState()
    p.clearQueue()       // 队列/当前曲目/streamUrl/isPlaying（停声音 + 清 MediaSession）
    p.clearSleepTimer()  // 上一个用户的睡眠定时器
    useFavoritesStore.getState().reset()
    useSearchStore.getState().reset()
  }, [authenticated])

  // 分享链接 ?uid= 自动播放 / ?playlist= 跳歌单详情（各只触发一次）。
  // 等登录完成后由 location 驱动：未登录时守卫会先拦去登录页（携带 redirect），
  // 登录回跳后 location 变化，在此接续——提前触发只会静默 401，且 ref 置位会导致回跳后不再播放。
  const playlistRef = useRef(false)
  useEffect(() => {
    if (authenticated !== true) return
    const params = new URLSearchParams(location.search)
    const uid = params.get('uid')
    if (uid && !autoPlayRef.current) {
      autoPlayRef.current = true
      void playByUid(uid).catch(() => {})
    }
    const pid = params.get('playlist')
    if (pid && !playlistRef.current) {
      playlistRef.current = true
      navigate(`/playlists/${pid}`, { replace: true })
    }
  }, [authenticated, location, playByUid, navigate])

  // 全局路由守卫：除登录页外，所有页面都必须有有效会话。
  // 携带原地址（含查询参数）作为 redirect，登录成功后回到来源页（分享链接 ?uid=/?playlist= 场景）。
  useEffect(() => {
    if (authenticated === null || setupRequired === true || location.pathname === '/setup') return
    if (authenticated === false && location.pathname !== '/login') {
      const params = new URLSearchParams(location.search)
      params.delete('lyrics')
      const from = location.pathname + (params.size ? `?${params}` : '')
      navigate(`/login?redirect=${encodeURIComponent(from)}`, { replace: true })
    }
  }, [authenticated, setupRequired, location.pathname, location.search, navigate])

  // 强制改密守卫：已登录但 mustChangePassword=true 时，除改密页外一律拦截到改密页
  useEffect(() => {
    if (authenticated !== true || !mustChangePassword) return
    if (location.pathname === '/change-password') return
    navigate('/change-password', { replace: true })
  }, [authenticated, mustChangePassword, location.pathname, navigate])

  // 路由切换 → 关闭抽屉
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // 抽屉打开时：ESC 关闭 + 锁定 body 滚动
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  // 服务异常与未完成状态都不能被误判为新安装。
  if (authError && !offlineUsername) {
    return <AuthLayout title="暂时无法连接" description="请检查网络或稍后再试。" footer="已有账号与数据会保留。">
      <p role="alert" className="mb-5 text-sm text-destructive">{authError}</p>
      <button onClick={() => void initAuth()} className="h-12 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground">重新连接</button>
    </AuthLayout>
  }
  if (authenticated === null && !offlineUsername) return <div role="status" className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">正在连接 Holly Music...</div>
  if (setupRequired === true) {
    return location.pathname === '/setup' ? <SetupPage /> : <Navigate to="/setup" replace />
  }
  if (location.pathname === '/setup' && !offlineUsername) return <Navigate to={authenticated ? '/' : '/login'} replace />

  // 登录页无需已有会话。
  if (location.pathname === '/login' && !offlineUsername) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </div>
    )
  }

  if (authenticated === false && !offlineUsername) return null
  if (mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />

  // 改密页同样必须已登录，但保持独立全屏布局。
  if (location.pathname === '/change-password' && !offlineUsername) {
    return <div className="min-h-dvh bg-background text-foreground"><ChangePasswordPage /></div>
  }

  return (
    <LyricsPanelContext.Provider value={lyricsPanel}>
      <div className="app-atmosphere app-viewport flex h-dvh flex-col text-foreground">
        <MobileHeader onMenuClick={() => setDrawerOpen(true)} />
        <div className="flex min-h-0 flex-1 overflow-hidden desktop:gap-3 desktop:px-3 desktop:pt-3">
          <Sidebar />
          <div className="app-main-frame flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {!offlineUsername && <CachedHomePage key={username} />}
            <main hidden={!offlineUsername && location.pathname === '/'} className="app-main min-h-0 min-w-0 flex-1 overflow-y-auto" tabIndex={0} aria-label="页面内容">
              {offlineUsername ? <Routes>
                <Route path="/equalizer" element={<EqualizerPage audio={audioElement} />} />
                <Route path="/offline" element={<OfflinePage />} />
                <Route path="*" element={<Navigate to="/offline" replace />} />
              </Routes> : <Routes>
                <Route path="/equalizer" element={<EqualizerPage audio={audioElement} />} />
                <Route path="/offline" element={<OfflinePage />} />
                <Route path="/" element={null} />
                <Route path="/recommend" element={<RecommendedMusicPage />} />
                <Route path="/discover/toplists/:id" element={<DiscoveryCollectionPage kind="toplists" />} />
                <Route path="/discover/playlists/:id" element={<DiscoveryCollectionPage kind="playlists" />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
                <Route path="/playlists" element={<PlaylistsPage />} />
                <Route path="/playlists/ai-create" element={<AiPlaylistPage />} />
                <Route path="/playlists/:id/ai-add" element={<AiPlaylistPage />} />
                <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/sources" element={<AdminSourcesPage />} />
                <Route path="/admin/recommend" element={<AdminRecommendPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>}
            </main>
          </div>
        </div>
        <PlayerBar audio={audioElement} onAudioElement={setAudioElement} onOpenEqualizer={() => {
          if (location.pathname !== '/equalizer') void navigate('/equalizer', { state: { equalizerEntry: true } })
        }} />
        <MobileSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <QueuePanel />
        <LyricsPanel audio={audioElement} />
        <SongContextMenu />
        <ToastContainer />
      </div>
    </LyricsPanelContext.Provider>
  )
}
