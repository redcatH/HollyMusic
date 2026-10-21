import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Sidebar, MobileSidebar } from '../src/components/Layout'
import { ServiceWorkerRegister } from '../src/components/ServiceWorkerRegister'
import { useAuthStore } from '@/hooks/useAuth'
import { usePwaInstall } from '@/hooks/usePwaInstall'

vi.mock('../src/components/AppearanceSettings', () => ({ AppearanceButton: () => null }))

let root: Root
let container: HTMLDivElement
let standalone = false
let auth: ReturnType<typeof useAuthStore.getState>
const closeDrawer = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  standalone = false
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: standalone })))
  auth = useAuthStore.getState()
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  closeDrawer.mockClear()
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  useAuthStore.setState(auth, true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function render() {
  await act(async () => {
    root.render(<MemoryRouter><ServiceWorkerRegister /><Sidebar onAbout={() => {}} /><MobileSidebar open onClose={closeDrawer} onAbout={() => {}} /></MemoryRouter>)
  })
}
async function openMenus() {
  await act(async () => {
    container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach(button => button.click())
  })
}
function installButtons() {
  return [...container.querySelectorAll('button')].filter(button => button.textContent?.trim() === '安装应用')
}
function installEvent(outcome: 'accepted' | 'dismissed' = 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome, platform: 'web' }),
  })
}

it('没有收到浏览器安装能力事件时，桌面与移动端用户名菜单都不显示安装', async () => {
  await render()
  await openMenus()
  expect(installButtons()).toHaveLength(0)
})

it('安装事件在菜单打开前捕获，两个菜单共享入口且一次事件只能触发一次原生提示', async () => {
  await render()
  const event = installEvent('accepted')
  await act(async () => { window.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  await openMenus()
  expect(installButtons()).toHaveLength(2)
  await act(async () => {
    installButtons()[1].click()
    await usePwaInstall.getState().install()
  })
  expect(event.prompt).toHaveBeenCalledTimes(1)
  expect(closeDrawer).toHaveBeenCalledTimes(1)
  expect(usePwaInstall.getState().canInstall).toBe(false)
  await openMenus()
  expect(installButtons()).toHaveLength(0)
})

it('取消安装后隐藏旧入口，收到新的浏览器安装事件才重新显示', async () => {
  await render()
  const first = installEvent()
  await act(async () => { window.dispatchEvent(first); await usePwaInstall.getState().install() })
  expect(usePwaInstall.getState().canInstall).toBe(false)
  const second = installEvent()
  await act(async () => { window.dispatchEvent(second) })
  await openMenus()
  expect(installButtons()).toHaveLength(2)
  await act(async () => { await usePwaInstall.getState().install() })
  expect(first.prompt).toHaveBeenCalledTimes(1)
  expect(second.prompt).toHaveBeenCalledTimes(1)
})

it('通过浏览器自身入口完成安装后，立即移除两个菜单中的安装按钮', async () => {
  await render()
  const event = installEvent()
  await act(async () => { window.dispatchEvent(event) })
  await openMenus()
  expect(installButtons()).toHaveLength(2)
  await act(async () => { window.dispatchEvent(new Event('appinstalled')) })
  expect(installButtons()).toHaveLength(0)
  await usePwaInstall.getState().install()
  expect(event.prompt).not.toHaveBeenCalled()
})

it('已处于独立应用窗口时不显示安装入口', async () => {
  standalone = true
  await render()
  await act(async () => { window.dispatchEvent(installEvent()) })
  await openMenus()
  expect(installButtons()).toHaveLength(0)
})

it('登录前收到的安装能力在登录后仍可从用户名菜单使用', async () => {
  useAuthStore.setState({ authenticated: false, username: null })
  await render()
  await act(async () => { window.dispatchEvent(installEvent()) })
  await act(async () => { useAuthStore.setState({ authenticated: true, username: 'alice' }) })
  await openMenus()
  expect(installButtons()).toHaveLength(2)
})
