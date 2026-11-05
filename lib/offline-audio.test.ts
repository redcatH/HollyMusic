import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cachePlayedTrack, cancelOfflineDownloads, clearOfflineTracks, getOfflineAudio, listOfflineTracks,
  CACHE_MB, OFFLINE_DEFAULT_LIMIT_BYTES, getOfflineCacheLimit, setOfflineCacheLimit, planOfflineCleanup } from './offline-audio'
import { toTrack } from './types/player'
import { preparePlaybackResponse } from './playback-response'
import { useAuthStore } from '@/hooks/useAuth'
import * as authApi from '@/lib/api/auth'
import { logger } from '@/lib/logger'
import { buildAudioUrl } from '@/lib/api/music'
import { readAudioDuration } from '@/lib/client/audio-duration'

// 原有用例只验证传输及容量语义，使用固定时长；解析器另用真实 WAV 验证。
vi.mock('@/lib/client/audio-duration', () => ({ readAudioDuration: vi.fn() }))

function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>()
  return {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      const key = (input: string | Request) => typeof input === 'string' ? input : input.url
      return {
        match: async (input: string | Request) => store.get(key(input))?.clone(),
        put: async (input: string | Request, response: Response) => {
          const bytes = await response.arrayBuffer()
          store.set(key(input), new Response(bytes, { status: response.status, headers: response.headers }))
        },
        keys: async () => [...store.keys()].map(url => new Request(url)),
        delete: async (input: string | Request) => store.delete(key(input)),
      }
    },
    delete: async (name: string) => stores.delete(name),
  }
}
const track = (id: string) => toTrack({ uid: `kw-${id}`, musicInfo: {
  name: `歌曲 ${id}`, singer: '歌手', source: 'kw', songmid: id, interval: '03:00',
  types: [], _types: {}, typeUrl: {},
} as Parameters<typeof toTrack>[0]['musicInfo'] })
const response = (size = 4) => new Response(new Uint8Array(size), {
  headers: { 'content-type': 'audio/mpeg', 'content-length': String(size) },
})
const nativeFetch = globalThis.fetch

beforeEach(() => {
  vi.mocked(readAudioDuration).mockReset().mockResolvedValue(180)
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { isSecureContext: true, caches: {}, location: { origin: 'https://holly.test' }, dispatchEvent: vi.fn(),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } } })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('caches', memoryCaches())
  vi.stubGlobal('fetch', vi.fn(async () => response()))
})
afterEach(() => { cancelOfflineDownloads(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('保存完整音频，按账号隔离，并从缓存返回可播放 Blob', async () => {
  await cachePlayedTrack('alice', track('1'), '320k')
  expect((await listOfflineTracks('alice'))[0]).toMatchObject({ size: 4, quality: '320k', track: { name: '歌曲 1' } })
  expect(await listOfflineTracks('bob')).toEqual([])
  const local = await getOfflineAudio('alice', 'kw-1', 'flac', ['128k', '320k'])
  expect(local?.quality).toBe('320k')
  const blob = await nativeFetch(local!.url)
  expect((await blob.arrayBuffer()).byteLength).toBe(4)
  URL.revokeObjectURL(local!.url)
  await clearOfflineTracks('alice')
  expect(await listOfflineTracks('alice')).toEqual([])
})

it('已缓存歌曲不重复下载；相同歌曲不同音质分别保存', async () => {
  await Promise.all([cachePlayedTrack('alice', track('1'), '320k'), cachePlayedTrack('alice', track('1'), '320k')])
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(fetch).toHaveBeenCalledTimes(1)
  await cachePlayedTrack('alice', track('1'), '128k')
  expect(await listOfflineTracks('alice')).toHaveLength(2)
})

it('完整下载的试听片段不落库，换源后同曲目可以重新缓存完整版', async () => {
  vi.mocked(readAudioDuration).mockResolvedValueOnce(30).mockResolvedValueOnce(180)
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(await listOfflineTracks('alice')).toEqual([])
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(fetch).toHaveBeenCalledTimes(2)
  const cache = await caches.open('holly-audio-v1:alice')
  expect((await cache.match('https://holly.test/__offline_audio/kw-1/320k'))?.headers.get('x-holly-duration')).toBe('180')
  expect(await getOfflineAudio('alice', 'kw-1', '320k', ['320k'])).not.toBeNull()
})

it('历史试听缓存读取时删除，保留其他歌曲和账号，后续可获取完整版', async () => {
  await cachePlayedTrack('alice', track('other'), '320k')
  await cachePlayedTrack('bob', track('1'), '320k')
  const cache = await caches.open('holly-audio-v1:alice')
  const key = 'https://holly.test/__offline_audio/kw-1/320k'
  await cache.put(key, new Response('part', { headers: {
    'content-type': 'audio/mpeg', 'content-length': '4',
    'x-holly-track': encodeURIComponent(JSON.stringify(track('1'))), 'x-holly-quality': '320k', 'x-holly-used': '1',
  } }))
  vi.mocked(readAudioDuration).mockResolvedValueOnce(30)
  expect(await getOfflineAudio('alice', 'kw-1', '320k', ['320k'])).toBeNull()
  expect(await cache.match(key)).toBeUndefined()
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-other'])
  expect(await listOfflineTracks('bob')).toHaveLength(1)
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'holly-offline-changed' }))
  await cachePlayedTrack('alice', track('1'), '320k')
  const local = await getOfflineAudio('alice', 'kw-1', '320k', ['320k'])
  expect(local).not.toBeNull()
  URL.revokeObjectURL(local!.url)
})

it('历史完整缓存补检一次保存真实时长，后续读取复用校验结果', async () => {
  const cache = await caches.open('holly-audio-v1:alice')
  const key = 'https://holly.test/__offline_audio/kw-1/320k'
  await cache.put(key, new Response('full', { headers: {
    'content-type': 'audio/mpeg', 'content-length': '4',
    'x-holly-track': encodeURIComponent(JSON.stringify(track('1'))), 'x-holly-quality': '320k', 'x-holly-used': '1',
  } }))
  for (let i = 0; i < 2; i++) {
    const local = await getOfflineAudio('alice', 'kw-1', '320k', ['320k'])
    expect(local).not.toBeNull()
    URL.revokeObjectURL(local!.url)
  }
  expect(readAudioDuration).toHaveBeenCalledOnce()
  expect((await cache.match(key))?.headers.get('x-holly-duration')).toBe('180')
  expect(fetch).not.toHaveBeenCalled()
})

it('长曲无法解析时长时跳过缓存，短曲仍可保存', async () => {
  vi.mocked(readAudioDuration).mockResolvedValue(0)
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(await listOfflineTracks('alice')).toEqual([])
  const short = track('short')
  short.duration = 60
  short.musicInfo.interval = '01:00'
  await cachePlayedTrack('alice', short, '320k')
  expect(await listOfflineTracks('alice')).toHaveLength(1)
})

it('已知试听缓存不会只刷新时间继续复用，离线可以回退同曲其他完整音质', async () => {
  await cachePlayedTrack('alice', track('1'), '320k')
  await cachePlayedTrack('alice', track('1'), '128k')
  const cache = await caches.open('holly-audio-v1:alice')
  const key = 'https://holly.test/__offline_audio/kw-1/320k'
  const old = (await cache.match(key))!
  const headers = new Headers(old.headers)
  headers.set('x-holly-duration', '30')
  await cache.put(key, new Response(old.body, { headers }))
  vi.stubGlobal('navigator', { onLine: false })
  const local = await getOfflineAudio('alice', 'kw-1', '320k', ['320k', '128k'])
  expect(local?.quality).toBe('128k')
  expect(await cache.match(key)).toBeUndefined()
  URL.revokeObjectURL(local!.url)
})

it('独立下载的时长检查被取消后不能提交或淘汰旧歌曲', async () => {
  await cachePlayedTrack('alice', track('old'), '320k')
  let resolve!: (duration: number) => void
  vi.mocked(readAudioDuration).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const task = cachePlayedTrack('alice', track('new'), '320k')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  cancelOfflineDownloads()
  resolve(180)
  await task
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-old'])
})

it('从播放响应保存离线歌曲，不再发起第二次 fetch', async () => {
  let port!: MessagePort
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (_data: unknown, ports: MessagePort[]) => { port = ports[0]; port.postMessage({ type: 'ready' }) },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  expect(await capture.ready).toBe(true)
  const caching = cachePlayedTrack('alice', track('1'), '320k')
  port.postMessage({ type: 'complete', blob: new Blob(['abcd']),
    headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })
  await caching
  expect(fetch).not.toHaveBeenCalled()
  expect(await listOfflineTracks('alice')).toHaveLength(1)
  const released = new Promise<MessageEvent>(resolve => { port.onmessage = event => { if (event.data.type === 'cancel') resolve(event) } })
  capture.cancel()
  expect((await released).data).toEqual({ type: 'cancel' })
  port.close()
})

it('SW 捕获的试听不会落入持久缓存，也不补发第二次下载', async () => {
  let port!: MessagePort
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (_data: unknown, ports: MessagePort[]) => { port = ports[0]; port.postMessage({ type: 'ready' }) },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  try {
    await capture.ready
    vi.mocked(readAudioDuration).mockResolvedValueOnce(30)
    const caching = cachePlayedTrack('alice', track('1'), '320k')
    port.postMessage({ type: 'complete', blob: new Blob(['part']),
      headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })
    await caching
    expect(fetch).not.toHaveBeenCalled()
    expect(await listOfflineTracks('alice')).toEqual([])
    // 当前试听仍可交付，拒绝缓存不会中断播放或让上游重新下载。
    expect(await (await capture.response)!.text()).toBe('part')
  } finally { capture.cancel(); port.close() }
})

it('时长校验期间同曲重播，旧任务不能改用新的播放响应落库', async () => {
  const ports: MessagePort[] = []
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (_data: unknown, transferred?: MessagePort[]) => {
      if (transferred?.[0]) { ports.push(transferred[0]); transferred[0].postMessage({ type: 'ready' }) }
    },
  } } })
  const url = buildAudioUrl('kw-1', '320k')
  const first = preparePlaybackResponse('alice', url, OFFLINE_DEFAULT_LIMIT_BYTES)!
  let second: typeof first | null = null
  try {
    await first.ready
    let resolve!: (duration: number) => void
    vi.mocked(readAudioDuration).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const task = cachePlayedTrack('alice', track('1'), '320k')
    ports[0].postMessage({ type: 'complete', blob: new Blob(['full']),
      headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    second = preparePlaybackResponse('alice', url, OFFLINE_DEFAULT_LIMIT_BYTES)!
    await second.ready
    ports[1].postMessage({ type: 'complete', blob: new Blob(['part']),
      headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })
    resolve(180)
    await task
    expect(await listOfflineTracks('alice')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  } finally { second?.cancel(); for (const port of ports) port.close() }
})

it('从分块清单流式落盘后确认释放，并以磁盘指针替换页面完成响应', async () => {
  let port!: MessagePort
  let captureId = ''
  const commands: string[] = []
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (data: { type: string; captureId: string }, ports?: MessagePort[]) => {
      commands.push(data.type)
      if (ports?.[0]) { captureId = data.captureId; port = ports[0]; port.postMessage({ type: 'ready' }) }
    },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  try {
    await capture.ready
    const temporary = await caches.open('holly-playback-data-v1')
    const base = `https://holly.test/__playback_data/alice-tab/${captureId}/`
    await temporary.put(base + '0', new Response('ab', { headers: { 'content-length': '2' } }))
    await temporary.put(base + '1', new Response('cd', { headers: { 'content-length': '2' } }))
    await temporary.put(base + 'complete', new Response(JSON.stringify({ version: 1, size: 4,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '4' },
      chunks: [{ key: base + '0', length: 2 }, { key: base + '1', length: 2 }],
    })))
    const acknowledged = new Promise<MessageEvent>(resolve => { port.onmessage = event => { if (event.data.type === 'cached') resolve(event) } })
    const caching = cachePlayedTrack('alice', track('1'), '320k')
    port.postMessage({ type: 'complete', cacheName: 'holly-playback-data-v1', cacheKey: base + 'complete' })
    await caching
    await acknowledged
    expect(commands).toContain('holly-cached-audio')
    expect(fetch).not.toHaveBeenCalled()
    expect(await listOfflineTracks('alice')).toHaveLength(1)
    for (const request of await temporary.keys()) await temporary.delete(request)
    expect(await (await capture.response)!.text()).toBe('abcd')
    const cache = await caches.open('holly-audio-v1:alice')
    const key = (await listOfflineTracks('alice'))[0].key
    const previous = await cache.match(key)
    await cache.put(key, new Response('WXYZ', { headers: previous!.headers }))
    // 再次读取必须来自持久缓存，不能从页面原先的完成 Promise/Blob 返回旧字节。
    expect(await (await capture.response)!.text()).toBe('WXYZ')
  } finally { capture.cancel(); port.close() }
})

it.each(['missing', 'invalid-json', 'invalid-manifest', 'missing-chunk', 'storage-error'])('共享音频 %s 时保留诊断，正常未命中保持安静', async scenario => {
  const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  let port!: MessagePort
  let captureId = ''
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (data: { captureId: string }, ports?: MessagePort[]) => {
      if (ports?.[0]) { captureId = data.captureId; port = ports[0]; port.postMessage({ type: 'ready' }) }
    },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  try {
    await capture.ready
    const base = `https://holly.test/__playback_data/alice-tab/${captureId}/`
    const cache = await caches.open('holly-playback-data-v1')
    if (scenario !== 'missing') {
      await cache.put(base + 'complete', new Response(scenario === 'invalid-json' ? '{' : JSON.stringify({
        version: scenario === 'invalid-manifest' ? 99 : 1, size: 4,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '4' }, chunks: [{ key: base + '0', length: 4 }],
      })))
    }
    if (scenario === 'storage-error') vi.spyOn(caches, 'open').mockRejectedValue(new DOMException('disk unavailable', 'InvalidStateError'))
    port.postMessage({ type: 'complete', cacheName: 'holly-playback-data-v1', cacheKey: base + 'complete' })
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await capture.response
      if (scenario === 'missing-chunk') await expect(response!.text()).rejects.toThrow('缓存分块不可用')
      else expect(response).toBeNull()
    }
    expect(warning).toHaveBeenCalledTimes(scenario === 'missing' ? 0 : 1)
    if (scenario !== 'missing') expect(warning).toHaveBeenCalledWith('[playback] 读取共享音频缓存失败',
      expect.objectContaining({ name: expect.any(String), message: expect.any(String) }))
  } finally { capture.cancel(); port.close() }
})

it('下载尚未完成时同账号重新认证，原缓存任务仍复用同一响应并成功落盘', async () => {
  let port!: MessagePort
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (_data: unknown, ports: MessagePort[]) => { port = ports[0]; port.postMessage({ type: 'ready' }) },
  } } })
  vi.spyOn(authApi, 'getMe').mockResolvedValue({ authenticated: true, username: 'alice', mustChangePassword: false,
    setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false })
  useAuthStore.setState({ authenticated: true, username: 'alice', loading: false, mustChangePassword: false })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  try {
    await capture.ready
    const caching = cachePlayedTrack('alice', track('1'), '320k')
    await useAuthStore.getState().init()
    const duplicate = cachePlayedTrack('alice', track('1'), '320k')
    port.postMessage({ type: 'complete', blob: new Blob(['abcd']),
      headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })
    await Promise.all([caching, duplicate])
    expect(fetch).not.toHaveBeenCalled()
    expect(await listOfflineTracks('alice')).toHaveLength(1)
  } finally {
    capture.cancel()
    port.close()
    await useAuthStore.getState().logout()
    useAuthStore.setState(useAuthStore.getInitialState(), true)
  }
})

it.each(['cancel', 'unavailable'])('播放捕获 %s 时跳过缓存，不额外下载且不阻塞后续任务', async reason => {
  let port!: MessagePort
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (_data: unknown, ports: MessagePort[]) => { port = ports[0]; port.postMessage({ type: 'ready' }) },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  await capture.ready
  const caching = cachePlayedTrack('alice', track('1'), '320k')
  if (reason === 'cancel') cancelOfflineDownloads()
  else port.postMessage({ type: 'unavailable' })
  await caching
  expect(fetch).not.toHaveBeenCalled()
  expect(await listOfflineTracks('alice')).toEqual([])
  await cachePlayedTrack('alice', track('2'), '320k')
  expect(await listOfflineTracks('alice')).toHaveLength(1)
  port.close()
})

it('旧 Service Worker 不响应握手时及时回退原有缓存方式', async () => {
  let port!: MessagePort
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (_data: unknown, ports: MessagePort[]) => { port = ports[0] },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  expect(await capture.ready).toBe(false)
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(fetch).toHaveBeenCalledTimes(1)
  port.close()
})

it.each([
  { type: 'ready', protocolVersion: 2 },
  { type: 'unavailable', protocolVersion: 1 },
])('SW 握手返回 $type v$protocolVersion 时回退独立下载，不遗留阻塞任务', async reply => {
  let port!: MessagePort
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (_data: unknown, ports?: MessagePort[]) => {
      if (ports?.[0]) { port = ports[0]; port.postMessage(reply) }
    },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  try {
    expect(await capture.ready).toBe(false)
    await cachePlayedTrack('alice', track('1'), '320k')
    expect(fetch).toHaveBeenCalledOnce()
    expect(await listOfflineTracks('alice')).toHaveLength(1)
  } finally { capture.cancel(); port.close() }
})

it('页面等待缓存超过 5 分钟只发送 cancel-cache，仍保留播放源用于后续主动释放', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let port!: MessagePort
  const commands: Array<{ type: string; preservePlayback?: boolean }> = []
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {
    postMessage: (data: { type: string; preservePlayback?: boolean }, ports?: MessagePort[]) => {
      commands.push(data)
      if (ports?.[0]) { port = ports[0]; port.postMessage({ type: 'ready' }) }
    },
  } } })
  const capture = preparePlaybackResponse('alice', buildAudioUrl('kw-1', '320k'), OFFLINE_DEFAULT_LIMIT_BYTES)!
  try {
    await capture.ready
    const stopped = new Promise<MessageEvent>(resolve => { port.onmessage = resolve })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect((await stopped).data).toEqual({ type: 'cancel-cache' })
    expect(await capture.response).toBeNull()
    expect(commands.at(-1)).toMatchObject({ type: 'holly-release-audio', preservePlayback: true })
    const released = new Promise<MessageEvent>(resolve => { port.onmessage = resolve })
    capture.cancel()
    expect((await released).data).toEqual({ type: 'cancel' })
  } finally { capture.cancel(); port.close(); vi.useRealTimers() }
})

it.each([
  () => new Response('part', { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } }),
  () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '2' } }),
  () => new Response('part', { headers: { 'content-type': 'audio/mpeg', 'content-length': '20' } }),
  () => new Response('part', { headers: { 'content-type': 'audio/mpeg' } }),
  () => new Response('part', { headers: { 'content-type': 'audio/mpeg', 'content-length': String(OFFLINE_DEFAULT_LIMIT_BYTES + 1) } }),
])('不把部分响应、错误数据、截断或超过总容量的音频标记为离线可用', async factory => {
  vi.mocked(fetch).mockResolvedValue(factory())
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(await listOfflineTracks('alice')).toEqual([])
})

it('清空或账号切换后，进行中的下载不能重新写回缓存', async () => {
  let resolve!: (response: Response) => void
  vi.mocked(fetch).mockImplementation(() => new Promise(done => { resolve = done }))
  const task = cachePlayedTrack('alice', track('1'), '320k')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  await clearOfflineTracks('alice')
  resolve(response())
  await task
  expect(await listOfflineTracks('alice')).toEqual([])
})

it('取消的下载尚未结束时可以排入同歌曲的重试，新任务仍保持去重', async () => {
  let resolve!: (response: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockResolvedValueOnce(response())
  const cancelled = cachePlayedTrack('alice', track('1'), '320k')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  cancelOfflineDownloads()
  const retry = cachePlayedTrack('alice', track('1'), '320k')
  const duplicate = cachePlayedTrack('alice', track('1'), '320k')
  resolve(response())
  await Promise.all([cancelled, retry, duplicate])
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(await listOfflineTracks('alice')).toHaveLength(1)
})

it('缓存超过 100 个音频但未用满总容量时，不淘汰歌曲', async () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => ++now)
  for (let i = 0; i < 100; i++) await cachePlayedTrack('alice', track(String(i)), '320k')
  await cachePlayedTrack('alice', track('0'), '320k')
  await cachePlayedTrack('alice', track('100'), '320k')
  const entries = await listOfflineTracks('alice')
  expect(entries).toHaveLength(101)
  expect(entries.some(entry => entry.track.uid === 'kw-0')).toBe(true)
  expect(entries.some(entry => entry.track.uid === 'kw-1')).toBe(true)
})

it('大于旧单首 100 MiB 限制的完整音频，在总容量内仍可缓存', async () => {
  const size = 106 * CACHE_MB
  vi.mocked(fetch).mockResolvedValue(response(size))
  await cachePlayedTrack('alice', track('large'), 'flac')
  expect((await listOfflineTracks('alice'))[0]).toMatchObject({ size, quality: 'flac' })
})

it('容量最低 100 MB，按账号保存；损坏或非法设置回退默认值', async () => {
  expect(getOfflineCacheLimit('alice')).toBe(500 * CACHE_MB)
  for (const invalid of [99 * CACHE_MB, NaN, Infinity, -1, 100.1]) {
    await expect(setOfflineCacheLimit('alice', invalid)).rejects.toThrow('100 MB')
  }
  expect((await setOfflineCacheLimit('alice', 100 * CACHE_MB)).saved).toBe(true)
  expect(getOfflineCacheLimit('alice')).toBe(100 * CACHE_MB)
  expect(getOfflineCacheLimit('bob')).toBe(500 * CACHE_MB)
  window.localStorage.setItem('holly-offline-limit:alice', '{bad')
  expect(getOfflineCacheLimit('alice')).toBe(OFFLINE_DEFAULT_LIMIT_BYTES)
})

// 容量清理只读取元数据；这些测试不必分配数百 MB 的音频数据。
async function seed(id: string, sizeMB: number, usedAt: number) {
  const key = `https://holly.test/__offline_audio/kw-${id}/320k`
  await (await caches.open('holly-audio-v1:alice')).put(key, new Response('audio', { headers: {
    'content-type': 'audio/mpeg', 'content-length': String(sizeMB * CACHE_MB),
    'x-holly-track': encodeURIComponent(JSON.stringify(track(id))), 'x-holly-quality': '320k', 'x-holly-used': String(usedAt),
  } }))
  return key
}

it('按实际空间和最近使用顺序清理；单曲超过总容量时保留现有缓存', async () => {
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  vi.mocked(fetch).mockResolvedValueOnce(new Response('audio', { headers: {
    'content-type': 'audio/mpeg', 'content-length': String(501 * CACHE_MB),
  } }))
  await cachePlayedTrack('alice', track('too-large'), '320k')
  expect(await listOfflineTracks('alice')).toHaveLength(2)
  vi.mocked(fetch).mockResolvedValueOnce(response())
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new', 'kw-recent'])
})

it.each(['QuotaExceededError', 'UnknownError'])('写入新歌曲失败（%s）时不淘汰任何旧歌曲', async name => {
  const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  vi.spyOn(cache, 'put').mockRejectedValue(new DOMException('存储失败', name))
  const deleted = vi.spyOn(cache, 'delete')
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect(deleted.mock.calls.filter(([key]) => String(key).includes('/__offline_audio/'))).toEqual([])
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-recent', 'kw-old'])
  expect(window.dispatchEvent).not.toHaveBeenCalled()
  expect(warning).toHaveBeenCalledWith('[offline] 歌曲缓存失败，不影响在线播放', { name, message: '存储失败' })
})

it('新歌曲写入期间取消，只移除新歌曲，旧歌曲完整保留且通知刷新', async () => {
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const put = cache.put.bind(cache)
  vi.spyOn(cache, 'put').mockImplementation(async (key, response) => {
    await put(key, response)
    if (String(key).includes('/__offline_audio/')) cancelOfflineDownloads()
  })
  const deleted = vi.spyOn(cache, 'delete')
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-recent', 'kw-old'])
  expect(deleted.mock.calls.filter(([key]) => String(key).includes('/__offline_audio/'))).toEqual([
    ['https://holly.test/__offline_audio/kw-new/320k'],
  ])
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'holly-offline-changed' }))
})

it('开始淘汰后取消仍保留已写入的新歌曲，不发生新旧歌曲同时丢失', async () => {
  const old = await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const remove = cache.delete.bind(cache)
  vi.spyOn(cache, 'delete').mockImplementation(async key => {
    const removed = await remove(key)
    if (key === old) cancelOfflineDownloads()
    return removed
  })
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new', 'kw-recent'])
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'holly-offline-changed' }))
})

it('淘汰中途删除失败时保留新歌曲，仍通知列表刷新已发生的删除', async () => {
  await seed('old', 250, 1)
  const middle = await seed('middle', 250, 2)
  await seed('recent', 250, 3)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const remove = cache.delete.bind(cache)
  vi.spyOn(cache, 'delete').mockImplementation(async key => {
    if (key === middle) throw new Error('删除失败')
    return remove(key)
  })
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new', 'kw-recent', 'kw-middle'])
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'holly-offline-changed' }))
})

it('读取淘汰计划期间取消，不写入新歌曲，也不删除旧歌曲', async () => {
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const keys = cache.keys.bind(cache)
  vi.spyOn(cache, 'keys').mockImplementationOnce(async () => {
    cancelOfflineDownloads()
    return keys()
  })
  const put = vi.spyOn(cache, 'put')
  const remove = vi.spyOn(cache, 'delete')
  await cachePlayedTrack('alice', track('new'), '320k')
  expect(put.mock.calls.filter(([key]) => String(key).includes('/__offline_audio/'))).toEqual([])
  expect(remove.mock.calls.filter(([key]) => String(key).includes('/__offline_audio/'))).toEqual([])
  expect(await listOfflineTracks('alice')).toHaveLength(2)
})

it('调低上限先预览并确认，计划变化时不会删除未经确认的歌曲', async () => {
  const old = await seed('old', 70, 1)
  await seed('recent', 70, 2)
  const preview = await setOfflineCacheLimit('alice', 100 * CACHE_MB)
  expect(preview.saved).toBe(false)
  expect(preview.cleanup).toMatchObject({ bytes: 70 * CACHE_MB, entries: [{ key: old }] })
  expect(await listOfflineTracks('alice')).toHaveLength(2)
  expect(getOfflineCacheLimit('alice')).toBe(OFFLINE_DEFAULT_LIMIT_BYTES)
  await seed('new', 70, 3)
  const changed = await setOfflineCacheLimit('alice', 100 * CACHE_MB, [old])
  expect(changed.saved).toBe(false)
  expect(changed.cleanup.entries).toHaveLength(2)
  expect(await listOfflineTracks('alice')).toHaveLength(3)
  const saved = await setOfflineCacheLimit('alice', 100 * CACHE_MB, changed.cleanup.entries.map(item => item.key))
  expect(saved.saved).toBe(true)
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new'])
  expect(getOfflineCacheLimit('alice')).toBe(100 * CACHE_MB)
})

it('保存设置失败时不删除缓存，恰好达到上限不清理', async () => {
  await seed('old', 60, 1)
  await seed('new', 40, 2)
  expect(planOfflineCleanup(await listOfflineTracks('alice'), 100 * CACHE_MB).entries).toEqual([])
  const extra = await seed('extra', 10, 3)
  expect(extra).toContain('extra')
  const preview = await setOfflineCacheLimit('alice', 100 * CACHE_MB)
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(setOfflineCacheLimit('alice', 100 * CACHE_MB, preview.cleanup.entries.map(item => item.key))).rejects.toThrow('无法保存')
  expect(await listOfflineTracks('alice')).toHaveLength(3)
})

it('浏览器不允许存储时不影响在线播放', async () => {
  vi.stubGlobal('window', { isSecureContext: false })
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(fetch).not.toHaveBeenCalled()
  expect(await listOfflineTracks('alice')).toEqual([])
})
