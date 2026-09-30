import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import type { Track } from '@/lib/types/player'

vi.mock('../src/components/Layout', () => ({ Sidebar: () => null, MobileSidebar: () => null }))
vi.mock('../src/components/MobileHeader', () => ({ MobileHeader: () => null }))
vi.mock('../src/components/ServiceWorkerRegister', () => ({ ServiceWorkerRegister: () => null }))
vi.mock('@/components/player/PlayerBar', () => ({ PlayerBar: () => null }))
vi.mock('@/components/player/QueuePanel', () => ({ QueuePanel: () => null }))
vi.mock('@/components/player/LyricsPanel', () => ({ LyricsPanel: () => null }))
vi.mock('@/components/toast/ToastContainer', () => ({ ToastContainer: () => null }))
vi.mock('@/components/shared/SongContextMenu', () => ({ SongContextMenu: () => null }))
vi.mock('../src/routes/HomePage', () => ({ HomePage: () => null }))
vi.mock('../src/routes/DiscoveryCollectionPage', () => ({ DiscoveryCollectionPage: () => null }))
vi.mock('../src/routes/RecommendedMusicPage', () => ({ RecommendedMusicPage: () => null }))
vi.mock('../src/routes/SearchPage', () => ({ SearchPage: () => null }))
vi.mock('../src/routes/FavoritesPage', () => ({ FavoritesPage: () => null }))
vi.mock('../src/routes/PlaylistsPage', () => ({ PlaylistsPage: () => null }))
vi.mock('../src/routes/PlaylistDetailPage', () => ({ PlaylistDetailPage: () => null }))
vi.mock('../src/routes/AiPlaylistPage', () => ({ AiPlaylistPage: () => null }))
vi.mock('../src/routes/HistoryPage', () => ({ HistoryPage: () => null }))
vi.mock('../src/routes/LoginPage', () => ({ LoginPage: () => null }))
vi.mock('../src/routes/ChangePasswordPage', () => ({ ChangePasswordPage: () => null }))
vi.mock('../src/routes/AdminPage', () => ({ AdminPage: () => null, AdminUsersPage: () => null, AdminSourcesPage: () => null, AdminRecommendPage: () => null }))

vi.mock('@/hooks/useAuth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    init: () => {}, authenticated: true, mustChangePassword: false,
  }),
}))
vi.mock('@/lib/store/player-store', () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) => selector({ playByUid: () => {} }),
}))
vi.mock('@/lib/store/favorites-store', () => ({
  useFavoritesStore: (selector: (state: unknown) => unknown) => selector({ load: () => {} }),
}))
vi.mock('@/lib/store/search-store', () => ({ useSearchStore: {} }))

let root: Root
let container: HTMLDivElement
let navigate: ReturnType<typeof useNavigate>
function TestApp() {
  navigate = useNavigate()
  return <App />
}
function page() {
  return <MemoryRouter initialEntries={['/playlists/1', '/playlists/2']} initialIndex={1}>
    <TestApp />
  </MemoryRouter>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  useContextMenuStore.getState().dismiss()
  vi.unstubAllGlobals()
})

function openMenu() {
  // 马上切换路由，确保关闭不受 store 的 350ms 保护期影响。
  useContextMenuStore.getState().openMenu({ uid: 'kw-1' } as Track, 10, 10, {
    playlistId: 2, entryId: 42, onRemoved: async () => {},
  })
  expect(useContextMenuStore.getState().menu).not.toBeNull()
}

it('浏览器后退和前进时强制关闭旧歌曲菜单', async () => {
  await act(async () => { root.render(page()) })
  openMenu()
  await act(async () => { await navigate(-1) })
  expect(useContextMenuStore.getState().menu).toBeNull()
  openMenu()
  await act(async () => { await navigate(1) })
  expect(useContextMenuStore.getState().menu).toBeNull()
})

it('查询参数变化时关闭菜单，同一路由普通重渲染不关闭', async () => {
  await act(async () => { root.render(page()) })
  openMenu()
  await act(async () => { root.render(page()) })
  expect(useContextMenuStore.getState().menu).not.toBeNull()
  await act(async () => { await navigate('/playlists/2?source=share') })
  expect(useContextMenuStore.getState().menu).toBeNull()
})
