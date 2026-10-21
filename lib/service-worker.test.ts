import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { loadServiceWorkerSource } from '../scripts/service-worker-source.mjs'
import { preparePlaybackResponse } from './playback-response'

const workerSource = await loadServiceWorkerSource(fileURLToPath(new URL('../', import.meta.url)))

function worker(development = false, storage?: ReturnType<typeof memoryCaches>) {
  const handlers: Record<string, (event: unknown) => void> = {}
  const cache = { addAll: vi.fn(async () => {}), match: vi.fn(async () => new Response('offline shell')) }
  const chunks = memoryCaches()
  const caches = storage ?? { open: vi.fn(async (name: string) => name === 'holly-playback-data-v1' ? chunks.open(name) : cache), keys: vi.fn(async () => [
    'holly-shell-0123456789abcdef', 'holly-shell-old', 'holly-static-v3', 'holly-pages-v3', 'holly-audio-v1:alice', 'other-app',
  ]), delete: vi.fn(async () => true) }
  const fetch = vi.fn<(request?: Request, init?: RequestInit) => Promise<Response>>(async () => { throw new TypeError('offline') })
  const diagnostics = vi.fn()
  const self = { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler },
    __HOLLY_SW_BUILD__: { version: '0123456789abcdef', precache: ['/', '/theme-init.js'] },
    clients: { claim: vi.fn(), get: vi.fn(async () => ({ postMessage: diagnostics })) }, skipWaiting: vi.fn(async () => {}),
    location: { origin: 'https://holly.test', href: `https://holly.test/sw.js${development ? '?mode=development' : ''}` } }
  class WorkerRequest extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, self.location.origin) : input, init)
    }
  }
  const context = createContext({
    self, caches, fetch, URL, Set, Map, Blob, setTimeout, clearTimeout,
    Request: WorkerRequest, Response, Headers, ReadableStream, AbortSignal, AbortController,
  })
  runInContext(workerSource, context)
  const inspect = () => runInContext(`({ bytes: audioMemoryBytes, writeBytes: audioWriteBytes, entries: [...audioCaptures.values()].map(entry => ({
    chunkCount: entry.chunks.length, resident: entry.chunks.reduce((sum, chunk) => sum + (chunk.data?.byteLength || 0), 0),
    persisted: !!entry.persisted, bodies: entry.bodies.size
  })) })`, context) as { bytes: number; writeBytes: number; entries: Array<{ chunkCount: number; resident: number; persisted: boolean; bodies: number }> }
  return { handlers, cache, caches, fetch, self, inspect, diagnostics }
}

it('必需资源预缓存失败会阻止安装，不激活残缺应用壳', async () => {
  const { handlers, cache } = worker()
  cache.addAll.mockRejectedValueOnce(new Error('missing chunk'))
  let install!: Promise<void>
  handlers.install({ waitUntil: (value: Promise<void>) => { install = value } })
  await expect(install).rejects.toThrow('missing chunk')
})

it('开发环境立即接管音频复用，不预缓存页面或拦截热更新资源', async () => {
  const { handlers, caches, self } = worker(true)
  let installed!: Promise<void>
  let activated!: Promise<void>
  handlers.install({ waitUntil: (value: Promise<void>) => { installed = value } })
  await installed
  handlers.activate({ waitUntil: (value: Promise<void>) => { activated = value } })
  await activated
  expect(self.skipWaiting).toHaveBeenCalledOnce()
  expect(self.clients.claim).toHaveBeenCalledOnce()
  expect(caches.open).not.toHaveBeenCalled()
  expect(caches.delete).not.toHaveBeenCalled()
  const respondWith = vi.fn()
  for (const path of ['/', '/theme-init.js', '/@vite/client']) {
    handlers.fetch({ request: new Request(`https://holly.test${path}`), respondWith })
  }
  expect(respondWith).not.toHaveBeenCalled()
  const port = registerAudio(handlers)
  const capture = vi.fn()
  handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1'),
    respondWith: capture, waitUntil: vi.fn() })
  expect(capture).toHaveBeenCalledOnce()
  expect((await capture.mock.calls[0][0]).status).toBe(502)
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'unavailable' })
})

function registerAudio(handlers: ReturnType<typeof worker>['handlers'], client = 'alice-tab', captureId?: string, cacheName = 'holly-audio-v1:alice', limit = 100) {
  const port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as null | ((event: unknown) => void), persisted: Promise.resolve() }
  handlers.message({ data: { type: 'holly-capture-audio', url: 'https://holly.test/api/audio?uid=kw-1', limit,
    ...(captureId ? { captureId, cacheName, cacheKey: 'https://holly.test/__offline_audio/kw-1/320k' } : {}),
  }, source: { id: client }, ports: [port], waitUntil: (value: Promise<void>) => { port.persisted = value } })
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' })
  return port
}

it.each([1, 2])('显式协议版本 %s 在兼容时握手，不兼容时拒绝且保留已有播放', async protocolVersion => {
  const current = worker()
  const old = registerAudio(current.handlers)
  const port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null as null | ((event: unknown) => void) }
  const lifetimes: Promise<void>[] = []
  current.handlers.message({ data: { type: 'holly-capture-audio', protocolVersion,
    url: 'https://holly.test/api/audio?uid=kw-1', limit: 100 }, source: { id: 'alice-tab' }, ports: [port],
    waitUntil: (value: Promise<void>) => { lifetimes.push(value) } })
  await Promise.all(lifetimes)
  expect(port.postMessage).toHaveBeenCalledWith({ type: protocolVersion === 1 ? 'ready' : 'unavailable', protocolVersion: 1 })
  expect(old.close).toHaveBeenCalledTimes(protocolVersion === 1 ? 1 : 0)
  expect(current.inspect().entries).toHaveLength(1)
  if (protocolVersion === 1) port.onmessage!({ data: { type: 'cancel' } })
  else old.onmessage!({ data: { type: 'cancel' } })
})

it('真实页面与编译后的 SW 通过 MessageChannel 完成握手、分块读取、确认和释放', async () => {
  const storage = memoryCaches()
  const current = worker(false, storage)
  const lifetimes: Promise<void>[] = []
  const commands: Array<{ type: string; protocolVersion?: number }> = []
  const endpoint = { postMessage(data: { type: string; protocolVersion?: number }, ports?: MessagePort[]) {
    commands.push(data)
    current.handlers.message({ data, source: { id: 'alice-tab' }, ports,
      waitUntil: (promise: Promise<void>) => { lifetimes.push(promise) } })
  } }
  vi.stubGlobal('window', { isSecureContext: true, caches: {}, location: { origin: 'https://holly.test' } })
  vi.stubGlobal('navigator', { serviceWorker: { controller: endpoint } })
  vi.stubGlobal('caches', storage)
  const capture = preparePlaybackResponse('alice', '/api/audio?uid=kw-1&quality=320k', 100)!
  try {
    expect(await capture.ready).toBe(true)
    expect(commands[0]).toMatchObject({ type: 'holly-capture-audio', protocolVersion: 1 })
    current.fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
    let playing!: Promise<Response>
    current.handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1&quality=320k',
      { headers: { range: 'bytes=2-4' } }), respondWith: (value: Promise<Response>) => { playing = value },
      waitUntil: (value: Promise<void>) => { lifetimes.push(value) } })
    expect(await (await playing).text()).toBe('cde')
    const response = await capture.response
    expect(response).not.toBeNull()
    expect(await response!.clone().text()).toBe('abcdefgh')
    await (await storage.open('holly-audio-v1:alice')).put('https://holly.test/__offline_audio/kw-1/320k', response!)
    capture.cached()
    await vi.waitFor(() => expect(current.inspect().entries[0].persisted).toBe(true))
    expect(current.fetch).toHaveBeenCalledOnce()
    expect(await (await capture.response)!.text()).toBe('abcdefgh')
  } finally {
    capture.cancel()
    await Promise.all(lifetimes)
    vi.unstubAllGlobals()
  }
  expect(current.inspect().entries).toHaveLength(0)
})

it('播放与缓存复用一次完整 Range 响应，拖拽取消旧播放后仍补齐完整数据', async () => {
  const { handlers, fetch, caches } = worker()
  const port = registerAudio(handlers)
  let stream!: ReadableStreamDefaultController<Uint8Array>
  fetch.mockImplementationOnce(async (request?: Request) => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller
      controller.enqueue(new TextEncoder().encode('abcd'))
      request!.signal.addEventListener('abort', () => controller.error(new Error('aborted')))
    } })
    expect(request!.headers.get('range')).toBeNull()
    return new Response(body, { headers: {
      'content-type': 'audio/mpeg', 'content-length': '8',
    } })
  })
  const audio = new AbortController()
  let response!: Promise<Response>
  let finished!: Promise<void>
  handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1', {
    headers: { range: 'bytes=0-' }, signal: audio.signal,
  }), respondWith: (value: Promise<Response>) => { response = value },
  waitUntil: (value: Promise<void>) => { finished = value } })
  const playback = await response
  expect(playback.status).toBe(206)
  expect(playback.headers.get('content-range')).toBe('bytes 0-7/8')
  const reader = playback.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('abcd')
  void reader.cancel()
  audio.abort()
  const seek = vi.fn()
  handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1', {
    headers: { range: 'bytes=6-' },
  }), respondWith: seek, waitUntil: vi.fn() })
  const seeking = await seek.mock.calls[0][0] as Response
  expect(seeking.status).toBe(206)
  expect(seeking.headers.get('content-range')).toBe('bytes 6-7/8')
  stream.enqueue(new TextEncoder().encode('efgh'))
  stream.close()
  await finished
  expect(fetch).toHaveBeenCalledTimes(1)
  const complete = port.postMessage.mock.calls.find(([data]) => data.type === 'complete')![0]
  const manifest = await (await (await caches.open(complete.cacheName)).match(complete.cacheKey))!.json()
  expect(complete.blob).toBeUndefined()
  const parts = await Promise.all(manifest.chunks.map(async (chunk: { key: string }) => (await (await caches.open(complete.cacheName)).match(chunk.key))!.text()))
  expect(parts.join('')).toBe('abcdefgh')
  expect(await seeking.text()).toBe('gh')
  port.onmessage!({ data: { type: 'cancel' } })
})

it('连续局部 Range 和探测共用一次完整下载，完成后仍从同一份数据 seek', async () => {
  const { handlers, fetch } = worker()
  const port = registerAudio(handlers)
  const otherPage = vi.fn()
  handlers.fetch({ clientId: 'bob-tab', request: new Request('https://holly.test/api/audio?uid=kw-1'), respondWith: otherPage })
  await expect(otherPage.mock.calls[0][0]).rejects.toThrow('offline')
  fetch.mockClear()
  fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
  for (const [range, expected] of [['bytes=0-1', 'ab'], ['bytes=2-4', 'cde'], ['bytes=5-', 'fgh'], ['bytes=-2', 'gh'], ['bytes=0-1', 'ab']]) {
    let response!: Promise<Response>
    let finished!: Promise<void>
    handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1', { headers: { range } }),
      respondWith: (value: Promise<Response>) => { response = value }, waitUntil: (value: Promise<void>) => { finished = value } })
    expect(await (await response).text()).toBe(expected)
    await finished
  }
  expect(fetch).toHaveBeenCalledOnce()
  expect(port.postMessage.mock.calls.filter(([data]) => data.type === 'complete')).toHaveLength(1)
  port.onmessage!({ data: { type: 'cancel' } })
})

it('支持 BYOB 的原生字节流使用有界读取，并正确处理 EOF', async () => {
  const { handlers, fetch } = worker()
  const port = registerAudio(handlers)
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ type: 'bytes', start(controller) {
    controller.enqueue(new TextEncoder().encode('abcdefgh'))
    controller.close()
  } }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
  const request = requestAudio(handlers, 'bytes=2-5')
  expect(await (await request.response).text()).toBe('cdef')
  await request.finished
  expect(port.postMessage.mock.calls.some(([data]) => data.type === 'complete')).toBe(true)
  port.onmessage!({ data: { type: 'cancel' } })
})

it.each(['truncated', 'oversize', 'cancelled'])('缓存遇到 %s 不发布完整歌曲，且不取消播放', async reason => {
  const { handlers, fetch } = worker()
  const port = registerAudio(handlers)
  fetch.mockResolvedValueOnce(new Response('abcd', { headers: {
    'content-type': 'audio/mpeg', 'content-length': reason === 'oversize' ? '101' : reason === 'truncated' ? '8' : '4',
  } }))
  let response!: Promise<Response>
  let finished!: Promise<void>
  handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1'),
    respondWith: (value: Promise<Response>) => { response = value }, waitUntil: (value: Promise<void>) => { finished = value } })
  if (reason === 'cancelled') port.onmessage!({ data: { type: 'cancel-cache' } })
  const playback = await response
  if (reason === 'truncated') await expect(playback.text()).rejects.toThrow()
  else expect(await playback.text()).toBe('abcd')
  await finished
  expect(port.postMessage.mock.calls.some(([data]) => data.type === 'complete')).toBe(false)
  port.onmessage!({ data: { type: 'cancel' } })
})

it('越界和无效 Range 不启动额外下载，合法的有界 Range 被正确截断', async () => {
  const { handlers, fetch } = worker()
  const port = registerAudio(handlers)
  fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
  for (const [range, status, expected] of [['bytes=8-', 416, ''], ['bytes=-0', 416, ''],
    ['bytes=3-999', 206, 'defgh'], ['bytes=4-2', 416, ''], ['bytes=0-1,4-5', 200, 'abcdefgh']] as const) {
    const result = vi.fn()
    handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1', { headers: { range } }),
      respondWith: result, waitUntil: vi.fn() })
    const response = await result.mock.calls[0][0] as Response
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(expected)
    if (status === 416) expect(response.headers.get('content-range')).toBe('bytes */8')
  }
  expect(fetch).toHaveBeenCalledOnce()
  port.onmessage!({ data: { type: 'cancel' } })
})

it('未知大小的音频回退顺序播放，不累积共享缓冲或生成完整缓存', async () => {
  const { handlers, fetch } = worker()
  const port = registerAudio(handlers)
  fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg' } }))
  const result = vi.fn()
  handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1'),
    respondWith: result, waitUntil: vi.fn() })
  expect(await (await result.mock.calls[0][0]).text()).toBe('abcdefgh')
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'unavailable' })
  const next = vi.fn()
  handlers.fetch({ clientId: 'alice-tab', request: new Request('https://holly.test/api/audio?uid=kw-1'), respondWith: next })
  await expect(next.mock.calls[0][0]).rejects.toThrow('offline')
  port.onmessage!({ data: { type: 'cancel' } })
})

function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>()
  return {
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      const key = (input: string | Request) => typeof input === 'string' ? input : input.url
      return {
        match: vi.fn(async (input: string | Request) => store.get(key(input))?.clone()),
        put: vi.fn(async (input: string | Request, response: Response) => {
          const bytes = await response.arrayBuffer()
          store.set(key(input), new Response(bytes, { status: response.status, headers: response.headers }))
        }),
        keys: vi.fn(async () => [...store.keys()].map(url => new Request(url))),
        delete: vi.fn(async (input: string | Request) => store.delete(key(input))),
        addAll: vi.fn(async () => {}),
      }
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  }
}

it('PWA 清单联网更新名称，断网及服务失败回退最近成功的清单', async () => {
  const storage = memoryCaches()
  const current = worker(false, storage)
  const cache = await storage.open('holly-shell-0123456789abcdef')
  await cache.put('/manifest.json', Response.json({ name: '旧站点', start_url: '/?source=pwa' }))
  const requestManifest = async () => {
    let response!: Promise<Response>
    current.handlers.fetch({ request: new Request('https://holly.test/manifest.json?name=new'),
      respondWith: (result: Promise<Response>) => { response = result } })
    return (await response).json()
  }
  current.fetch.mockResolvedValueOnce(Response.json({ name: '新站点', start_url: '/?source=pwa' }, { headers: { 'content-type': 'application/manifest+json' } }))
  expect(await requestManifest()).toMatchObject({ name: '新站点' })
  expect(await requestManifest()).toMatchObject({ name: '新站点' })
  current.fetch.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
  expect(await requestManifest()).toMatchObject({ name: '新站点' })
  current.fetch.mockResolvedValueOnce(new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }))
  expect(await requestManifest()).toMatchObject({ name: '新站点' })
  current.fetch.mockResolvedValueOnce(Response.json({ success: false }))
  expect(await requestManifest()).toMatchObject({ name: '新站点' })
})

async function seedOffline(storage: ReturnType<typeof memoryCaches>, account = 'alice', body = 'abcdefgh') {
  await (await storage.open(`holly-audio-v1:${account}`)).put('https://holly.test/__offline_audio/kw-1/320k', new Response(body, {
    headers: { 'content-type': 'audio/mpeg', 'content-length': String(body.length),
      'x-holly-track': encodeURIComponent(JSON.stringify({ uid: 'kw-1' })), 'x-holly-quality': '320k', etag: '"song-v1"' },
  }))
}

function requestAudio(handlers: ReturnType<typeof worker>['handlers'], range: string, clientId = 'alice-tab', ifRange?: string) {
  let response!: Promise<Response>
  let finished!: Promise<void>
  handlers.fetch({ clientId, request: new Request('https://holly.test/api/audio?uid=kw-1', { headers: { range, ...(ifRange ? { 'if-range': ifRange } : {}) } }),
    respondWith: (value: Promise<Response>) => { response = value }, waitUntil: (value: Promise<void>) => { finished = value } })
  return { response, finished }
}

it.each(['open', 'chunk', 'manifest'])('临时存储 %s 挂起时先交付播放，写盘超时只放弃缓存并清理迟到写入', async blocked => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const storage = memoryCaches()
  const temporary = await storage.open('holly-playback-data-v1')
  const put = temporary.put.getMockImplementation()!
  let unblock!: () => void
  const gate = new Promise<void>(resolve => { unblock = resolve })
  temporary.put.mockImplementation(async (key, response) => {
    if ((String(key).endsWith('/complete') ? 'manifest' : 'chunk') === blocked) await gate
    await put(key, response)
  })
  const open = storage.open.getMockImplementation()!
  storage.open.mockImplementation(async name => {
    if (name !== 'holly-playback-data-v1') return open(name)
    if (blocked === 'open') await gate
    return temporary
  })
  const current = worker(false, storage)
  const port = registerAudio(current.handlers, 'alice-tab', 'slow-disk')
  await port.persisted
  current.fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
  try {
    const { response, finished } = requestAudio(current.handlers, 'bytes=0-')
    expect(await (await response).text()).toBe('abcdefgh')
    await vi.advanceTimersByTimeAsync(0)
    expect(port.postMessage.mock.calls.some(([data]) => data.type === 'complete')).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    await finished
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'unavailable' })
    expect(current.inspect().writeBytes).toBe(0)
    expect(await (await requestAudio(current.handlers, 'bytes=-2').response).text()).toBe('gh')
    expect(current.fetch).toHaveBeenCalledOnce()
    unblock()
    await vi.advanceTimersByTimeAsync(0)
    if (blocked === 'chunk' || blocked === 'manifest') {
      expect((await temporary.keys()).some(request => request.url.endsWith(blocked === 'chunk' ? '/0' : '/complete'))).toBe(false)
    }
    expect(port.postMessage.mock.calls.some(([data]) => data.type === 'complete')).toBe(false)
  } finally { unblock(); port.onmessage!({ data: { type: 'cancel' } }); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers() }
})

it.each([16 * 1024, 256 * 1024])('快速下载（每块 %s 字节）遇到正常的写盘延迟时，仍能完成整首缓存且保持内存有界', async chunkBytes => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const storage = memoryCaches()
  const temporary = await storage.open('holly-playback-data-v1')
  const put = temporary.put.getMockImplementation()!
  let peakWriteBytes = 0
  temporary.put.mockImplementation(async (key, response) => {
    peakWriteBytes = Math.max(peakWriteBytes, current.inspect().writeBytes)
    await new Promise(resolve => setTimeout(resolve, 10))
    await put(key, response)
  })
  const open = storage.open.getMockImplementation()!
  storage.open.mockImplementation(async name => name === 'holly-playback-data-v1' ? temporary : open(name))
  const current = worker(false, storage)
  const port = registerAudio(current.handlers, 'alice-tab', 'fast-download', 'holly-audio-v1:alice', 500_000_000)
  await port.persisted
  const bytes = new Uint8Array(4 * 1024 * 1024).fill(97)
  let offset = 0
  const stream = new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return }
    controller.enqueue(bytes.slice(offset, offset + chunkBytes))
    offset += chunkBytes
  } })
  current.fetch.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) } }))
  try {
    const { response, finished } = requestAudio(current.handlers, 'bytes=0-')
    const body = (await response).arrayBuffer()
    await vi.advanceTimersByTimeAsync(4_000)
    await finished
    expect(Buffer.from(await body).equals(Buffer.from(bytes))).toBe(true)
    expect(current.inspect().writeBytes).toBe(0)
    expect(peakWriteBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(current.inspect().bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(port.postMessage.mock.calls.some(([data]) => data.type === 'complete')).toBe(true)
    expect(port.postMessage.mock.calls.some(([data]) => data.type === 'unavailable')).toBe(false)
    expect(current.fetch).toHaveBeenCalledOnce()
  } finally { port.onmessage!({ data: { type: 'cancel' } }); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers() }
})

it('写盘挂起时队列保持有界，积压只停止缓存，网络数据继续交给播放', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const storage = memoryCaches()
  const temporary = await storage.open('holly-playback-data-v1')
  let unblock!: () => void
  temporary.put.mockImplementation(() => new Promise<void>(resolve => { unblock = resolve }))
  const open = storage.open.getMockImplementation()!
  storage.open.mockImplementation(async name => name === 'holly-playback-data-v1' ? temporary : open(name))
  const current = worker(false, storage)
  const port = registerAudio(current.handlers, 'alice-tab', 'busy-disk', 'holly-audio-v1:alice', 500_000_000)
  await port.persisted
  const bytes = new Uint8Array(3 * 1024 * 1024).fill(97)
  current.fetch.mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) } }))
  try {
    const { response, finished } = requestAudio(current.handlers, 'bytes=0-')
    const body = (await response).arrayBuffer()
    await vi.advanceTimersByTimeAsync(0)
    expect(current.inspect().writeBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    await vi.advanceTimersByTimeAsync(250)
    expect(Buffer.from(await body).equals(Buffer.from(bytes))).toBe(true)
    await finished
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'unavailable' })
    expect(current.inspect().writeBytes).toBe(0)
    expect(current.fetch).toHaveBeenCalledOnce()
    expect(temporary.put).toHaveBeenCalledOnce()
  } finally { unblock?.(); port.onmessage!({ data: { type: 'cancel' } }); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers() }
})

it('持续正常传输超过 5 分钟，只放弃缓存落盘，不截断播放或触发额外下载', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { handlers, fetch } = worker()
  const port = registerAudio(handlers)
  let source!: ReadableStreamDefaultController<Uint8Array>
  let signal!: AbortSignal
  fetch.mockImplementationOnce(async (request?: Request) => {
    signal = request!.signal
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      source = controller
      controller.enqueue(new TextEncoder().encode('a'))
    } }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } })
  })
  try {
    const { response, finished } = requestAudio(handlers, 'bytes=0-')
    const body = (await response).text()
    for (const char of 'bcdefgh') {
      await vi.advanceTimersByTimeAsync(50_000)
      source.enqueue(new TextEncoder().encode(char))
      await vi.advanceTimersByTimeAsync(0)
    }
    source.close()
    expect(await body).toBe('abcdefgh')
    await finished
    expect(signal.aborted).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'unavailable' })
    expect(port.postMessage.mock.calls.some(([data]) => data.type === 'complete')).toBe(false)
    expect(await (await requestAudio(handlers, 'bytes=6-').response).text()).toBe('gh')
  } finally { port.onmessage!({ data: { type: 'cancel' } }); vi.useRealTimers() }
})

it.each([false, true])('写盘挂起=%s 时，网络仍在持续停滞 60 秒后失败并唤醒 Range', async slowDisk => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const storage = memoryCaches()
  const temporary = await storage.open('holly-playback-data-v1')
  let unblock!: () => void
  if (slowDisk) temporary.put.mockImplementation(() => new Promise<void>(resolve => { unblock = resolve }))
  const open = storage.open.getMockImplementation()!
  storage.open.mockImplementation(async name => name === 'holly-playback-data-v1' ? temporary : open(name))
  const { handlers, fetch } = worker(false, storage)
  const port = registerAudio(handlers)
  let signal!: AbortSignal
  fetch.mockImplementationOnce(async (request?: Request) => {
    signal = request!.signal
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('ab'))
      signal.addEventListener('abort', () => controller.error(new Error('stalled')))
    } }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } })
  })
  try {
    const { response, finished } = requestAudio(handlers, 'bytes=6-')
    const body = (await response).text()
    const failure = expect(body).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(60_000)
    await failure
    await finished
    expect(signal.aborted).toBe(true)
  } finally { unblock?.(); port.onmessage!({ data: { type: 'cancel' } }); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers() }
})

it('向页面发送缓存清单失败也不影响已经下载好的播放和后续 Range', async () => {
  const { handlers, fetch } = worker()
  const port = registerAudio(handlers)
  port.postMessage.mockImplementation(data => {
    if (data.type === 'complete') throw new Error('cannot send manifest')
  })
  fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
  const initial = requestAudio(handlers, 'bytes=0-')
  expect(await (await initial.response).text()).toBe('abcdefgh')
  await initial.finished
  expect(await (await requestAudio(handlers, 'bytes=6-').response).text()).toBe('gh')
  expect(fetch).toHaveBeenCalledOnce()
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'unavailable' })
  port.onmessage!({ data: { type: 'cancel' } })
})

it('大于内存预算的歌曲仍一次下载落盘；预算按所有页面合计，提交后释放缓冲且已有播放流连续', async () => {
  const storage = memoryCaches()
  const current = worker(false, storage)
  const size = 12 * 1024 * 1024 + 17
  const bytes = new Uint8Array(size).map((_, index) => index % 251)
  const port = registerAudio(current.handlers, 'alice-tab', 'large-alice', 'holly-audio-v1:alice', 500_000_000)
  await port.persisted
  current.fetch.mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(size) } }))
  const original = requestAudio(current.handlers, 'bytes=0-')
  const playback = await original.response
  // 暂不消费 Audio 的完整响应，模拟暂停/慢速读取，落盘时仍有活跃的响应流。
  await original.finished
  expect(current.inspect().bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
  expect(current.inspect().entries[0].resident).toBeLessThan(size)
  const complete = port.postMessage.mock.calls.find(([data]) => data.type === 'complete')![0]
  expect(complete.blob).toBeUndefined()
  const other = registerAudio(current.handlers, 'other-tab', 'other-audio', 'holly-audio-v1:bob', 500_000_000)
  await other.persisted
  current.fetch.mockResolvedValueOnce(new Response(new Uint8Array(5 * 1024 * 1024), {
    headers: { 'content-type': 'audio/mpeg', 'content-length': String(5 * 1024 * 1024) },
  }))
  const second = requestAudio(current.handlers, 'bytes=0-1', 'other-tab')
  await (await second.response).arrayBuffer()
  await second.finished
  expect(current.inspect().bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
  other.onmessage!({ data: { type: 'cancel' } })
  await (await storage.open('holly-audio-v1:alice')).put('https://holly.test/__offline_audio/kw-1/320k', new Response(bytes, { headers: {
    'content-type': 'audio/mpeg', 'content-length': String(size), 'x-holly-verified-size': String(size),
    'x-holly-track': encodeURIComponent(JSON.stringify({ uid: 'kw-1' })), 'x-holly-quality': '320k',
  } }))
  let persisted!: Promise<void>
  current.handlers.message({ source: { id: 'alice-tab' }, data: { type: 'holly-cached-audio', captureId: 'large-alice',
    url: 'https://holly.test/api/audio?uid=kw-1' }, waitUntil: (value: Promise<void>) => { persisted = value } })
  await persisted
  expect(current.inspect().bytes).toBe(0)
  expect(current.inspect().entries[0].chunkCount).toBe(0)
  expect(current.inspect().entries[0].persisted).toBe(true)
  const temp = await storage.open('holly-playback-data-v1')
  expect((await temp.keys()).filter(request => request.url.includes('/large-alice/'))).toEqual([])
  expect(Buffer.from(await playback.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true)
  const suffix = await requestAudio(current.handlers, `bytes=${size - 4}-`).response
  expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(-4))
  expect(current.fetch).toHaveBeenCalledTimes(2) // 两个页面各一份完整下载，没有补发 Range。
  port.onmessage!({ data: { type: 'cancel' } })
})

it('临时分块存储不可用时保持内存预算，已淘汰的区间回退代理播放而不中断', async () => {
  const storage = memoryCaches()
  const temporary = await storage.open('holly-playback-data-v1')
  temporary.put.mockRejectedValue(new Error('QuotaExceededError'))
  temporary.match.mockRejectedValue(new Error('storage unavailable'))
  const open = storage.open.getMockImplementation()!
  storage.open.mockImplementation(async name => name === 'holly-playback-data-v1' ? temporary : open(name))
  const current = worker(false, storage)
  const size = 9 * 1024 * 1024
  const port = registerAudio(current.handlers, 'alice-tab', 'no-disk', 'holly-audio-v1:alice', 500_000_000)
  await port.persisted
  current.fetch.mockResolvedValueOnce(new Response(new Uint8Array(size).fill(97), {
    headers: { 'content-type': 'audio/mpeg', 'content-length': String(size) },
  })).mockResolvedValueOnce(new Response('aaaa', { status: 206, headers: {
    'content-type': 'audio/mpeg', 'content-length': '4', 'content-range': `bytes 0-3/${size}`,
  } }))
  const first = requestAudio(current.handlers, `bytes=${size - 4}-`)
  expect(await (await first.response).text()).toBe('aaaa')
  await first.finished
  expect(current.inspect().bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
  expect(await (await requestAudio(current.handlers, 'bytes=0-3').response).text()).toBe('aaaa')
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'unavailable' })
  expect(current.diagnostics).toHaveBeenCalledWith(expect.objectContaining({ operation: 'write-chunk', message: 'QuotaExceededError' }))
  expect(current.diagnostics).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read-chunk', message: 'storage unavailable' }))
  port.onmessage!({ data: { type: 'cancel' } })
})

it.each([false, true])('SW 存储错误限频，诊断通道失效=%s 也不影响网络回退', async disconnected => {
  const storage = memoryCaches()
  storage.open.mockRejectedValue(new DOMException('disk full', 'QuotaExceededError'))
  const current = worker(false, storage)
  if (disconnected) current.self.clients.get.mockRejectedValue(new Error('page closed'))
  current.fetch.mockImplementation(async () => new Response('network'))
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(await (await requestAudio(current.handlers, 'bytes=0-').response).text()).toBe('network')
  }
  if (disconnected) expect(current.diagnostics).not.toHaveBeenCalled()
  else expect(current.diagnostics).toHaveBeenCalledExactlyOnceWith({ type: 'holly-sw-diagnostic',
    operation: 'restore-audio', name: 'QuotaExceededError', message: 'disk full' })
  expect(current.self.clients.get).toHaveBeenCalledWith('alice-tab')
})

it('正常未命中与用户取消不产生存储错误诊断', async () => {
  const current = worker(false, memoryCaches())
  current.fetch.mockImplementation(async () => new Response('network'))
  await (await requestAudio(current.handlers, 'bytes=0-').response).text()
  const port = registerAudio(current.handlers)
  port.onmessage!({ data: { type: 'cancel-cache' } })
  port.onmessage!({ data: { type: 'cancel' } })
  await Promise.resolve()
  expect(current.diagnostics).not.toHaveBeenCalled()
})

it('落盘后取消缓存写入仍可离线拖动，SW 重启后也保留登记，显式释放才清除', async () => {
  const storage = memoryCaches()
  const current = worker(false, storage)
  const port = registerAudio(current.handlers, 'alice-tab', 'keep-playing')
  await port.persisted
  current.fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
  const initial = requestAudio(current.handlers, 'bytes=0-1')
  expect(await (await initial.response).text()).toBe('ab')
  await initial.finished
  await seedOffline(storage)
  let persisted!: Promise<void>
  current.handlers.message({ source: { id: 'alice-tab' }, data: { type: 'holly-cached-audio', captureId: 'keep-playing',
    url: 'https://holly.test/api/audio?uid=kw-1' }, waitUntil: (value: Promise<void>) => { persisted = value } })
  await persisted
  expect(current.inspect().entries[0]).toMatchObject({ persisted: true, chunkCount: 0 })
  expect(await (await requestAudio(current.handlers, 'bytes=-2').response).text()).toBe('gh')
  // 页面断网、修改容量或缓存超时都会先取消端口缓存任务，再通知当前 SW 保留播放。
  port.onmessage!({ data: { type: 'cancel-cache' } })
  current.handlers.message({ source: { id: 'alice-tab' }, data: { type: 'holly-release-audio', captureId: 'keep-playing',
    url: 'https://holly.test/api/audio?uid=kw-1', preservePlayback: true } })
  expect(await (await requestAudio(current.handlers, 'bytes=-2').response).text()).toBe('gh')
  expect(current.fetch).toHaveBeenCalledOnce()
  const restarted = worker(false, storage)
  expect(await (await requestAudio(restarted.handlers, 'bytes=2-4').response).text()).toBe('cde')
  expect(restarted.fetch).not.toHaveBeenCalled()
  let released!: Promise<void>
  restarted.handlers.message({ source: { id: 'alice-tab' }, data: { type: 'holly-release-audio', captureId: 'keep-playing',
    url: 'https://holly.test/api/audio?uid=kw-1', preservePlayback: false }, waitUntil: (value: Promise<void>) => { released = value } })
  await released
  await expect(requestAudio(restarted.handlers, 'bytes=-2').response).rejects.toThrow('offline')
  expect(restarted.fetch).toHaveBeenCalledOnce()
  port.onmessage!({ data: { type: 'cancel' } })
})

it('SW 重启后从已落盘歌曲恢复有界、后缀及越界 Range，离线不访问网络', async () => {
  const storage = memoryCaches()
  const first = worker(false, storage)
  const port = registerAudio(first.handlers, 'alice-tab', 'capture-alice')
  await port.persisted
  first.fetch.mockResolvedValueOnce(new Response('abcdefgh', { headers: { 'content-type': 'audio/mpeg', 'content-length': '8' } }))
  const initial = requestAudio(first.handlers, 'bytes=0-1')
  expect(await (await initial.response).text()).toBe('ab')
  await initial.finished
  await seedOffline(storage)
  // 新运行实例只有相同 Cache Storage，没有原实例的 Map、端口或字节缓冲。
  const restarted = worker(false, storage)
  for (const [range, status, expected] of [['bytes=3-5', 206, 'def'], ['bytes=-2', 206, 'gh'], ['bytes=9-', 416, '']] as const) {
    const response = await requestAudio(restarted.handlers, range).response
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(expected)
  }
  const matching = await requestAudio(restarted.handlers, 'bytes=3-5', 'alice-tab', '"song-v1"').response
  expect(matching.status).toBe(206)
  expect(await matching.text()).toBe('def')
  const stale = await requestAudio(restarted.handlers, 'bytes=3-5', 'alice-tab', '"old-version"').response
  expect(stale.status).toBe(200)
  expect(await stale.text()).toBe('abcdefgh')
  expect(restarted.fetch).not.toHaveBeenCalled()
  expect(first.fetch).toHaveBeenCalledOnce()
  port.onmessage!({ data: { type: 'cancel' } })
})

it.each(['missing', 'corrupt', 'different-client'])('SW 重启后缓存 %s 时回退网络，不读取其他账号或残缺数据', async reason => {
  const storage = memoryCaches()
  const first = worker(false, storage)
  const port = registerAudio(first.handlers, 'alice-tab', 'capture-alice')
  await port.persisted
  if (reason === 'corrupt') {
    const cache = await storage.open('holly-audio-v1:alice')
    await seedOffline(storage)
    const response = await cache.match('https://holly.test/__offline_audio/kw-1/320k')
    const headers = new Headers(response!.headers)
    headers.set('content-length', '99')
    await cache.put('https://holly.test/__offline_audio/kw-1/320k', new Response('abcd', { headers }))
  }
  await seedOffline(storage, 'bob', 'BBBBBBBB')
  const restarted = worker(false, storage)
  restarted.fetch.mockResolvedValueOnce(new Response('network'))
  const response = await requestAudio(restarted.handlers, 'bytes=3-5', reason === 'different-client' ? 'bob-tab' : 'alice-tab').response
  expect(await response.text()).toBe('network')
  expect(restarted.fetch).toHaveBeenCalledOnce()
  port.onmessage!({ data: { type: 'cancel' } })
})

it('SW 重启后取消缓存仍保留播放登记，只有当前播放源的 release 才删除登记', async () => {
  const storage = memoryCaches()
  const first = worker(false, storage)
  const alice = registerAudio(first.handlers, 'alice-tab', 'old-alice')
  await alice.persisted
  await seedOffline(storage)
  await seedOffline(storage, 'bob', 'BBBBBBBB')
  const restarted = worker(false, storage)
  const bob = registerAudio(restarted.handlers, 'alice-tab', 'new-bob', 'holly-audio-v1:bob')
  await bob.persisted
  let released!: Promise<void>
  restarted.handlers.message({ source: { id: 'alice-tab' }, data: { type: 'holly-release-audio', captureId: 'old-alice',
    url: 'https://holly.test/api/audio?uid=kw-1', preservePlayback: false }, waitUntil: (value: Promise<void>) => { released = value } })
  await released
  const again = worker(false, storage)
  expect(await (await requestAudio(again.handlers, 'bytes=2-4').response).text()).toBe('BBB')
  again.handlers.message({ source: { id: 'alice-tab' }, data: { type: 'holly-release-audio', captureId: 'new-bob',
    url: 'https://holly.test/api/audio?uid=kw-1', preservePlayback: true }, waitUntil: (value: Promise<void>) => { released = value } })
  expect(await (await requestAudio(again.handlers, 'bytes=2-4').response).text()).toBe('BBB')
  expect(again.fetch).not.toHaveBeenCalled()
  const afterCancel = worker(false, storage)
  expect(await (await requestAudio(afterCancel.handlers, 'bytes=-2').response).text()).toBe('BB')
  expect(afterCancel.fetch).not.toHaveBeenCalled()
  afterCancel.handlers.message({ source: { id: 'alice-tab' }, data: { type: 'holly-release-audio', captureId: 'new-bob',
    url: 'https://holly.test/api/audio?uid=kw-1', preservePlayback: false }, waitUntil: (value: Promise<void>) => { released = value } })
  await released
  await expect(requestAudio(again.handlers, 'bytes=2-4').response).rejects.toThrow('offline')
  alice.onmessage!({ data: { type: 'cancel' } })
  bob.onmessage!({ data: { type: 'cancel' } })
})

it('激活新版本只清理应用壳旧缓存，保留歌曲及其他应用缓存', async () => {
  const { handlers, caches } = worker()
  let activation!: Promise<void>
  handlers.activate({ waitUntil: (value: Promise<void>) => { activation = value } })
  await activation
  expect(caches.delete.mock.calls.map(([key]) => key)).toEqual(['holly-shell-old', 'holly-static-v3', 'holly-pages-v3'])
})

it('断网深层路由及带查询参数的安装启动地址均回退首页壳', async () => {
  const { handlers, cache } = worker()
  for (const route of ['/playlists/2', '/?source=pwa']) {
    let result!: Promise<Response>
    handlers.fetch({ request: { headers: new Headers(), method: 'GET', mode: 'navigate', url: `https://holly.test${route}` },
      respondWith: (value: Promise<Response>) => { result = value } })
    expect(await (await result).text()).toBe('offline shell')
  }
  expect(cache.match).toHaveBeenCalledWith('/')
})

it('API、Subsonic、跨域和写入请求不会写入应用壳缓存', () => {
  const { handlers } = worker()
  const respondWith = vi.fn()
  for (const [url, method] of [
    ['https://holly.test/api/audio?uid=kw-1', 'GET'], ['https://holly.test/rest/stream', 'GET'],
    ['https://upstream.test/file.mp3', 'GET'], ['https://holly.test/', 'POST'],
  ]) handlers.fetch({ request: { headers: new Headers(), method, url }, respondWith })
  expect(respondWith).not.toHaveBeenCalled()
})

it('Range、授权请求与音频 destination 不经过应用壳缓存', () => {
  const { handlers } = worker()
  const respondWith = vi.fn()
  for (const request of [
    { headers: new Headers({ Range: 'bytes=0-10' }) },
    { headers: new Headers({ Authorization: 'Bearer test' }) },
    { headers: new Headers(), destination: 'audio' },
  ]) handlers.fetch({ request: { method: 'GET', url: 'https://holly.test/icon.svg', ...request }, respondWith })
  expect(respondWith).not.toHaveBeenCalled()
})
