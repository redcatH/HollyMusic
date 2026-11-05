import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildServiceWorker } from '../scripts/build-service-worker.mjs'
import { loadServiceWorkerSource } from '../scripts/service-worker-source.mjs'

let project: string
const workerSource = new URL('../public/sw.js', import.meta.url)
beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), 'holly-sw-build-'))
  for (const directory of ['public', 'lib', 'frontend/dist/assets', 'frontend/dist/icons']) {
    await mkdir(path.join(project, directory), { recursive: true })
  }
  await writeFile(path.join(project, 'public/sw.js'), await readFile(workerSource))
  await writeFile(path.join(project, 'lib/playback-protocol.ts'), await readFile(new URL('./playback-protocol.ts', import.meta.url)))
  await writeFile(path.join(project, 'lib/audio-integrity.ts'), await readFile(new URL('./audio-integrity.ts', import.meta.url)))
  for (const resource of ['index.html', 'manifest.json', 'icon.svg', 'theme-init.js', 'assets/app.js',
    'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']) {
    await writeFile(path.join(project, 'frontend/dist', resource), resource)
  }
  await writeFile(path.join(project, 'frontend/dist/assets/app.js.map'), '{}')
})
afterEach(async () => {
  // 仅清理由本测试创建的系统临时目录。
  if (path.dirname(project) === path.resolve(tmpdir()) && path.basename(project).startsWith('holly-sw-build-')) {
    await rm(project, { recursive: true, force: true })
  }
})

it('构建后的真实 Worker 使用注入版本和完整资源清单，与源码引号和换行无关', async () => {
  const source = (await readFile(workerSource, 'utf8')).replaceAll("'", '"').replace('const VERSION =', 'const VERSION\n  =')
  await writeFile(path.join(project, 'public/sw.js'), source)
  const config = await buildServiceWorker(project)
  expect(config.version).toMatch(/^[a-f0-9]{16}$/)
  expect(config.precache).toEqual(['/', '/assets/app.js', '/icon.svg', '/icons/apple-touch-icon.png',
    '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/manifest.json', '/theme-init.js'])
  const handlers: Record<string, (event: unknown) => void> = {}
  const addAll = vi.fn<(requests: Request[]) => Promise<void>>().mockResolvedValue()
  const open = vi.fn(async () => ({ addAll }))
  class WorkerRequest extends Request {
    constructor(input: string, init?: RequestInit) { super(new URL(input, 'https://holly.test'), init) }
  }
  runInNewContext(await readFile(path.join(project, 'frontend/dist/sw.js'), 'utf8'), {
    self: { location: { href: 'https://holly.test/sw.js' },
      addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler } },
    URL, Request: WorkerRequest, caches: { open },
  })
  let installed!: Promise<void>
  handlers.install({ waitUntil: (promise: Promise<void>) => { installed = promise } })
  await installed
  expect(open).toHaveBeenCalledWith(`holly-shell-${config.version}`)
  expect(addAll.mock.calls[0][0].map((request: Request) => new URL(request.url).pathname)).toEqual(config.precache)
})

it('相同输入版本稳定，资源或 Worker 内容变化都会改变版本', async () => {
  const first = await buildServiceWorker(project)
  expect(await buildServiceWorker(project)).toEqual(first)
  await writeFile(path.join(project, 'frontend/dist/assets/app.js'), 'new application')
  const second = await buildServiceWorker(project)
  expect(second.version).not.toBe(first.version)
  await writeFile(path.join(project, 'public/sw.js'), (await readFile(workerSource, 'utf8')) + '\n// update\n')
  expect((await buildServiceWorker(project)).version).not.toBe(second.version)
})

it('共享协议变更会更新 Worker 内容版本', async () => {
  const first = await buildServiceWorker(project)
  const file = path.join(project, 'lib/playback-protocol.ts')
  await writeFile(file, (await readFile(file, 'utf8')).replace('holly-playback-data-v1', 'holly-playback-data-v2'))
  expect((await buildServiceWorker(project)).version).not.toBe(first.version)
})

it('试听判定规则变化会更新 Worker 内容版本', async () => {
  const first = await buildServiceWorker(project)
  const file = path.join(project, 'lib/audio-integrity.ts')
  await writeFile(file, (await readFile(file, 'utf8')).replace('0.8', '0.9'))
  expect((await buildServiceWorker(project)).version).not.toBe(first.version)
})

it.each(['theme-init.js', 'icons/icon-192.png'])('必需资源 %s 缺失时构建失败', async resource => {
  await rm(path.join(project, 'frontend/dist', resource))
  await expect(buildServiceWorker(project)).rejects.toThrow()
})

it('生产 Worker 缺少构建配置时明确失败，开发 Worker 可直接运行', async () => {
  const source = await loadServiceWorkerSource(project)
  const context = (mode: string) => ({ self: { location: { href: `https://holly.test/sw.js${mode}` }, addEventListener: vi.fn() }, URL })
  expect(() => runInNewContext(source, context(''))).toThrow('SW 缺少有效构建配置')
  expect(() => runInNewContext(source, context('?mode=development'))).not.toThrow()
})
