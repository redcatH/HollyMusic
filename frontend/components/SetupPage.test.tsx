import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SetupPage } from '../src/routes/SetupPage'
import { useAuthStore } from '@/hooks/useAuth'

const { apiSetup, getMe } = vi.hoisted(() => ({ apiSetup: vi.fn(), getMe: vi.fn() }))
vi.mock('@/lib/api/auth', () => ({
  setup: apiSetup, getMe, login: vi.fn(), logout: vi.fn(), heartbeat: vi.fn(), changePassword: vi.fn(),
}))
vi.mock('../src/components/AppearanceSettings', () => ({ AppearanceButton: () => null }))

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useAuthStore.setState({ authenticated: false, setupRequired: true, setupTokenRequired: false, error: null })
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter initialEntries={['/setup']}><Routes>
    <Route path="/setup" element={<SetupPage />} /><Route path="/" element={<p>已进入首页</p>} />
  </Routes></MemoryRouter>) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  getMe.mockResolvedValue({ authenticated: false, setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false, mustChangePassword: false, username: null })
  await useAuthStore.getState().init()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function fill(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

it('复用登录页品牌与表单布局，固定管理员名称，默认不要求初始化码', () => {
  expect(container.querySelector('.login-page')).not.toBeNull()
  expect(container.querySelector('.login-record-scene')).not.toBeNull()
  expect(container.querySelector<HTMLInputElement>('#setup-username')?.value).toBe('admin')
  expect(container.querySelector<HTMLInputElement>('#setup-username')?.readOnly).toBe(true)
  expect(container.querySelector('#setup-token')).toBeNull()
})
it('密码不一致时就近报错，不提交 API', async () => {
  await fill('setup-password', 'good-password')
  await fill('setup-confirmation', 'another-password')
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('不一致')
  expect(apiSetup).not.toHaveBeenCalled()
})
it('成功设置后自动登录，不进入强制改密页', async () => {
  apiSetup.mockResolvedValue(undefined)
  await fill('setup-password', 'good-password')
  await fill('setup-confirmation', 'good-password')
  await submit()
  expect(apiSetup).toHaveBeenCalledWith('good-password', 'good-password', '')
  expect(useAuthStore.getState()).toMatchObject({ authenticated: true, username: 'admin', setupRequired: false, mustChangePassword: false })
  expect(container.textContent).toContain('已进入首页')
})
it('提交期间防止重复提交，失败后可以重试', async () => {
  let reject!: (error: Error) => void
  apiSetup.mockImplementation(() => new Promise((_, rejectPromise) => { reject = rejectPromise }))
  await fill('setup-password', 'good-password')
  await fill('setup-confirmation', 'good-password')
  await submit()
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  await act(async () => { reject(new Error('暂时无法连接服务')) })
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('暂时无法连接服务')
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
})
it('服务查询失败不误判为首次设置', async () => {
  getMe.mockRejectedValueOnce(new Error('数据库暂时不可用'))
  await act(async () => { await useAuthStore.getState().init() })
  expect(useAuthStore.getState()).toMatchObject({ setupRequired: null, authenticated: null, error: '数据库暂时不可用' })
})
it('配置初始化码时才展示并要求填写该字段', async () => {
  await act(async () => { useAuthStore.setState({ setupTokenRequired: true }) })
  expect(container.querySelector('#setup-token')).not.toBeNull()
  await fill('setup-password', 'good-password')
  await fill('setup-confirmation', 'good-password')
  await submit()
  expect(apiSetup).not.toHaveBeenCalled()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('初始化码')
  await fill('setup-token', 'deployment-token')
  apiSetup.mockResolvedValue(undefined)
  await submit()
  expect(apiSetup).toHaveBeenCalledWith('good-password', 'good-password', 'deployment-token')
})
it('另一个页面已完成设置时重新查询状态，避免继续停留在首次设置', async () => {
  apiSetup.mockRejectedValueOnce(Object.assign(new Error('已初始化'), { status: 409 }))
  getMe.mockResolvedValueOnce({ authenticated: false, setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false, mustChangePassword: false, username: null })
  await fill('setup-password', 'good-password')
  await fill('setup-confirmation', 'good-password')
  await submit()
  expect(getMe).toHaveBeenCalled()
  expect(useAuthStore.getState()).toMatchObject({ authenticated: false, setupRequired: false })
})
