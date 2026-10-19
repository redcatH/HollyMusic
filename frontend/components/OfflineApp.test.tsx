import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useAuthStore } from '@/hooks/useAuth'
import { offlineIdentity, isOfflineStorageAvailable } from '@/lib/offline-audio'

vi.mock('@/lib/api/auth', () => ({ getMe: vi.fn(async () => { throw new TypeError('offline') }) }))
vi.mock('@/components/player/PlayerBar', () => ({ PlayerBar: () => null }))
vi.mock('@/components/player/QueuePanel', () => ({ QueuePanel: () => null }))
vi.mock('@/components/player/LyricsPanel', () => ({ LyricsPanel: () => null }))
vi.mock('@/components/shared/SongContextMenu', () => ({ SongContextMenu: () => null }))

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

function Location() {
  return <output data-route>{useLocation().pathname}</output>
}

it('离线可直接打开声音设置，返回后回到本地歌曲', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  offlineIdentity.write('alice')
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/equalizer']}><App /><Location /></MemoryRouter>))
    expect(container.querySelector('[data-route]')?.textContent).toBe('/equalizer')
    expect(container.querySelector('h1')?.textContent).toBe('声音设置')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!.click())
    expect(container.querySelector('[data-route]')?.textContent).toBe('/offline')
  } finally { await act(async () => root.unmount()) }
})

it.each(['/?source=pwa', '/recommend', '/search', '/favorites', '/playlists/1', '/history', '/admin', '/change-password', '/setup', '/login'])('断网从 %s 冷启动保留布局并跳转到本地歌曲', async route => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  offlineIdentity.write('alice')
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<MemoryRouter initialEntries={[route]}><App /><Location /></MemoryRouter>) })
    expect(container.textContent).toContain('本地歌曲')
    expect(container.textContent).toContain('离线模式 · alice')
    expect(container.textContent).toContain('暂无可离线播放的歌曲')
    expect(container.textContent).not.toContain('正在连接 Holly Music')
    expect(useAuthStore.getState().authenticated).toBeNull()
    expect(container.querySelector('[data-route]')?.textContent).toBe('/offline')
    expect(container.querySelector('header')).not.toBeNull()
    expect(container.querySelectorAll('aside')).toHaveLength(2)
    for (const label of ['首页', '推荐', '搜索', '收藏', '歌单', '历史']) {
      const entries = [...container.querySelectorAll('nav [role="link"]')].filter(element => element.textContent === label)
      expect(entries).toHaveLength(2)
      for (const entry of entries) {
        expect(entry.getAttribute('aria-disabled')).toBe('true')
        expect(entry.hasAttribute('href')).toBe(false)
        await act(async () => { (entry as HTMLElement).click() })
        expect(container.querySelector('[data-route]')?.textContent).toBe('/offline')
      }
    }
    expect(container.querySelectorAll('nav a[href="/offline"]')).toHaveLength(isOfflineStorageAvailable() ? 2 : 0)
  } finally { await act(async () => root.unmount()) }
})
