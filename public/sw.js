/** 构建时注入内容版本和完整资源清单。歌曲元数据及持久缓存仍由前端管理。 */
const DEVELOPMENT = new URL(self.location.href).searchParams.get('mode') === 'development'
const BUILD = self.__HOLLY_SW_BUILD__
if (!DEVELOPMENT && (!BUILD || !/^[a-f0-9]{16}$/.test(BUILD.version)
  || !Array.isArray(BUILD.precache) || !BUILD.precache.includes('/'))) {
  throw new Error('SW 缺少有效构建配置，请运行 pnpm -C frontend build')
}
const VERSION = BUILD?.version ?? 'shell-dev'
const PRECACHE = BUILD?.precache ?? []
const SHELL_CACHE = `holly-shell-${VERSION}`
const ASSETS = new Set(PRECACHE)
const PROTOCOL = self.__HOLLY_PLAYBACK_PROTOCOL__
const MESSAGE = PROTOCOL.message
const PLAYBACK_SESSIONS = PROTOCOL.sessionsCache
const AUDIO_STALL_MS = 60_000
const AUDIO_DATA_CACHE = PROTOCOL.dataCache
const AUDIO_MEMORY_BYTES = 8 * 1024 * 1024
const AUDIO_CHUNK_BYTES = PROTOCOL.chunkBytes
const AUDIO_WRITE_BYTES = 2 * 1024 * 1024
const AUDIO_WRITE_MS = 5_000
const hotChunks = new Map()
let audioMemoryBytes = 0
let audioWriteBytes = 0

const diagnosticTimes = new Map()
async function reportAudioDiagnostic(operation, error, clientId) {
  if (error?.name === 'AbortError') return
  const now = Date.now()
  if (now - (diagnosticTimes.get(operation) ?? -Infinity) < 30_000) return
  diagnosticTimes.set(operation, now)
  try {
    const clients = clientId ? [await self.clients.get(clientId)] : await self.clients.matchAll({ type: 'window' })
    for (const client of clients) client?.postMessage({ type: MESSAGE.DIAGNOSTIC, operation,
      name: String(error?.name || 'Error').slice(0, 80), message: String(error?.message || error).slice(0, 500) })
  } catch { /* 页面已关闭或消息不可用时，诊断不能影响播放和清理。 */ }
}

function stopAudioWrites(entry) {
  if (entry.writesStopped) return
  entry.writesStopped = true
  entry.stopWrites?.()
  for (const chunk of entry.writeQueue || []) {
    audioWriteBytes -= chunk.length
    chunk.pending = null
  }
  entry.writeQueue = []
}

async function audioWrite(entry, action) {
  let timer
  const operation = Promise.resolve().then(action)
  try {
    await Promise.race([operation, entry.writesCancelled.then(() => { throw new Error('音频写盘已取消') }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('音频写盘超时')), AUDIO_WRITE_MS) })])
  } finally { clearTimeout(timer) }
}

async function queueAudioWrite(entry, chunk, data) {
  if (entry.writesStopped) return
  // 到达全局队列上限时只让出一次事件循环，不能等待存储腾出空间。
  if (audioWriteBytes + data.byteLength > AUDIO_WRITE_BYTES) await new Promise(resolve => setTimeout(resolve, 0))
  if (entry.writesStopped) return
  if (audioWriteBytes + data.byteLength > AUDIO_WRITE_BYTES) { entry.diskFailed = true; entry.unavailable(); return }
  chunk.pending = data
  audioWriteBytes += chunk.length
  entry.writeQueue.push(chunk)
  if (entry.diskDrain) return
  entry.diskDrain = (async () => {
    try {
      while (entry.writeQueue.length && !entry.writesStopped) {
        const next = entry.writeQueue.shift()
        try {
          await audioWrite(entry, async () => {
            const cache = await caches.open(AUDIO_DATA_CACHE)
            if (entry.writesStopped) return
            await cache.put(next.key, new Response(next.pending, { headers: { 'Content-Length': String(next.length) } }))
            // Cache API 没有取消接口；超时/释放后迟到的写入不能留下孤儿块。
            if (entry.writesStopped) await cache.delete(next.key)
          })
        } catch (error) {
          if (!entry.writesStopped) void reportAudioDiagnostic('write-chunk', error, entry.clientId)
          entry.diskFailed = true
          entry.unavailable()
        }
        finally { next.pending = null; audioWriteBytes -= next.length }
      }
    } finally { entry.diskDrain = null }
  })()
}

function audioReader(stream) {
  try {
    const reader = stream.getReader({ mode: 'byob' })
    return { read: () => reader.read(new Uint8Array(AUDIO_CHUNK_BYTES)), cancel: () => reader.cancel(), releaseLock: () => reader.releaseLock() }
  } catch { return stream.getReader() }
}

function rememberChunk(chunk, data) {
  if (hotChunks.has(chunk)) { audioMemoryBytes -= hotChunks.get(chunk); hotChunks.delete(chunk) }
  chunk.data = data
  hotChunks.set(chunk, data.byteLength)
  audioMemoryBytes += data.byteLength
  while (audioMemoryBytes > AUDIO_MEMORY_BYTES) {
    const oldest = hotChunks.keys().next().value
    audioMemoryBytes -= hotChunks.get(oldest)
    hotChunks.delete(oldest)
    oldest.data = null
  }
}
function dropAudioMemory(entry) {
  for (const chunk of entry.chunks) {
    if (hotChunks.has(chunk)) { audioMemoryBytes -= hotChunks.get(chunk); hotChunks.delete(chunk) }
    chunk.data = null
  }
}
function audioDataKey(clientId, captureId, part) {
  return PROTOCOL.dataKey(clientId, captureId, part, self.location.origin)
}
async function deleteAudioData(entry) {
  const cache = await caches.open(AUDIO_DATA_CACHE)
  for (const chunk of entry.chunks) await cache.delete(chunk.key)
  await cache.delete(entry.stageKey)
}
async function deleteAudioDataPrefix(clientId, captureId) {
  const cache = await caches.open(AUDIO_DATA_CACHE)
  const prefix = audioDataKey(clientId, captureId, '')
  for (const request of await cache.keys()) if (request.url.startsWith(prefix)) await cache.delete(request)
}
async function pruneAudioData(active) {
  if (!(await caches.keys()).includes(AUDIO_DATA_CACHE)) return
  for (const entry of audioCaptures.values()) if (!active.has(entry.clientId)) await entry.release()
  const cache = await caches.open(AUDIO_DATA_CACHE)
  for (const request of await cache.keys()) {
    const id = decodeURIComponent(new URL(request.url).pathname.split('/')[2])
    if (!active.has(id)) await cache.delete(request)
  }
}
async function pruneClosedAudio() {
  if (!self.clients.matchAll) return
  const active = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map(client => client.id))
  await pruneAudioData(active)
}

// 仅保存页面 -> 账号歌曲缓存的指针，不额外存一份音频，不改变离线容量预算。
let sessionTasks = Promise.resolve()
function withSessions(action) {
  const run = () => self.navigator?.locks
    ? self.navigator.locks.request(PLAYBACK_SESSIONS, action) : action()
  const task = sessionTasks.then(run, run)
  sessionTasks = task.catch(() => {})
  return task
}
function sessionKey(clientId, url) {
  return PROTOCOL.sessionKey(clientId, url, self.location.origin)
}
async function sessionRecord(cache, key, clientId) {
  const response = await cache.match(key)
  try { return response ? await response.json() : null } catch (error) {
    await reportAudioDiagnostic('read-session', error, clientId)
    return null
  }
}
function saveSession(clientId, url, record) {
  return withSessions(async () => {
    const cache = await caches.open(PLAYBACK_SESSIONS)
    if (self.clients.matchAll) {
      const active = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map(client => client.id))
      await pruneAudioData(active)
      for (const request of await cache.keys()) {
        const id = decodeURIComponent(new URL(request.url).pathname.split('/')[2])
        if (!active.has(id)) await cache.delete(request)
      }
    }
    await cache.put(sessionKey(clientId, url), new Response(JSON.stringify(record), {
      headers: { 'Content-Type': 'application/json' },
    }))
  })
}
function forgetSession(clientId, url, captureId) {
  return withSessions(async () => {
    const cache = await caches.open(PLAYBACK_SESSIONS)
    const key = sessionKey(clientId, url)
    const record = await sessionRecord(cache, key, clientId)
    if (record?.captureId === captureId) await cache.delete(key)
  })
}

function validSession(data, url) {
  return PROTOCOL.isSession(data, url)
}

// 每个页面/播放源只持有一次不带 Range 的完整下载，所有 Audio Range 从这里读取。
const audioCaptures = new Map()
self.addEventListener('message', event => {
  const data = event.data
  const port = event.ports?.[0]
  if (!PROTOCOL.isWorkerCommand(data) || !event.source?.id) return
  if (!PROTOCOL.isCompatibleVersion(data.protocolVersion)) {
    if (data.type === MESSAGE.CAPTURE && port) {
      port.postMessage({ type: MESSAGE.UNAVAILABLE, protocolVersion: PROTOCOL.version })
      port.close()
    }
    return
  }
  if (data.type === MESSAGE.PRUNE) {
    event.waitUntil?.(pruneClosedAudio().catch(error => reportAudioDiagnostic('prune-audio', error, event.source.id)))
    return
  }
  let url
  try { url = new URL(data.url) } catch { return }
  if (url.origin !== self.location.origin || url.pathname !== '/api/audio') return
  const key = `${event.source.id}:${url.href}`
  if (data.type === MESSAGE.CACHED_AUDIO) {
    const entry = audioCaptures.get(key)
    if (entry?.captureId === data.captureId) event.waitUntil?.(persistAudio(entry).catch(error => reportAudioDiagnostic('persist-audio', error, entry.clientId)))
    return
  }
  if (data.type === MESSAGE.RELEASE) {
    const entry = audioCaptures.get(key)
    // 取消缓存写入不释放播放源；后续 Range（包括 SW 重启后）仍需要持久登记。
    if (data.preservePlayback) {
      if (entry?.captureId === data.captureId) entry.unavailable()
      return
    }
    if (entry?.captureId === data.captureId) {
      event.waitUntil?.(entry.release())
    }
    if ((!entry || entry.captureId !== data.captureId) && typeof data.captureId === 'string') {
      event.waitUntil?.(deleteAudioDataPrefix(event.source.id, data.captureId).catch(error => reportAudioDiagnostic('delete-chunks', error, event.source.id)))
    }
    event.waitUntil?.(forgetSession(event.source.id, url.href, data.captureId).catch(error => reportAudioDiagnostic('delete-session', error, event.source.id)))
    return
  }
  if (!port || !Number.isSafeInteger(data.limit) || data.limit <= 0) return
  const old = audioCaptures.get(key)
  if (old) event.waitUntil?.(old.release())
  const entry = { port, captureId: data.captureId || `${Date.now()}-${Math.random()}`, limit: data.limit,
    clientId: event.source.id, url: url.href, request: null,
    chunks: [], downloaded: 0, size: 0, type: '', bodies: new Set(),
    cacheName: data.cacheName, cacheKey: data.cacheKey,
    complete: false, error: null, cacheCancelled: false, headersReady: null, download: null,
    writeQueue: [], diskDrain: null,
    controller: new AbortController(), waiters: new Set(),
    notify() { for (const wake of entry.waiters) wake(); entry.waiters.clear() },
    unavailable() {
      clearTimeout(entry.cacheTimer)
      stopAudioWrites(entry)
      if (!entry.cacheCancelled) port.postMessage({ type: MESSAGE.UNAVAILABLE })
      entry.cacheCancelled = true
    },
    detach() { if (audioCaptures.get(key) === entry) audioCaptures.delete(key) },
    release() {
      clearTimeout(entry.cacheTimer)
      clearTimeout(entry.stallTimer)
      if (audioCaptures.get(key) === entry) audioCaptures.delete(key)
      entry.error = new Error('播放源已释放')
      entry.controller.abort()
      entry.notify()
      entry.unavailable()
      dropAudioMemory(entry)
      port.close()
      return (entry.download || Promise.resolve()).then(() => deleteAudioData(entry))
        .catch(error => reportAudioDiagnostic('delete-chunks', error, entry.clientId))
    },
  }
  entry.writesCancelled = new Promise(resolve => { entry.stopWrites = resolve })
  entry.stageKey = audioDataKey(event.source.id, entry.captureId, 'complete')
  entry.dataKey = part => audioDataKey(event.source.id, entry.captureId, part)
  // 这是缓存落盘的期限，不是正常播放下载的总时长限制。
  entry.cacheTimer = setTimeout(() => entry.unavailable(), 5 * 60_000)
  port.onmessage = event => {
    if (!PROTOCOL.isPortCommand(event.data)) return
    if (event.data.type === MESSAGE.CANCEL) void entry.release()
    // 清空缓存/会话失效只禁止落盘，不中断仍在播放的 Audio；切歌时再 release。
    if (event.data.type === MESSAGE.CANCEL_CACHE) entry.unavailable()
    if (event.data.type === MESSAGE.CACHED) void persistAudio(entry).catch(error => reportAudioDiagnostic('persist-audio', error, entry.clientId))
  }
  audioCaptures.set(key, entry)
  if (validSession(data, url)) {
    event.waitUntil?.(saveSession(event.source.id, url.href, {
      captureId: data.captureId, cacheName: data.cacheName, cacheKey: data.cacheKey,
    }).catch(error => reportAudioDiagnostic('save-session', error, event.source.id)))
  }
  port.postMessage({ type: MESSAGE.READY, ...(data.protocolVersion === undefined ? {} : { protocolVersion: PROTOCOL.version }) })
})

function resetAudioStall(entry) {
  clearTimeout(entry.stallTimer)
  entry.stallTimer = setTimeout(() => {
    entry.error = new Error('音频下载持续 60 秒没有数据')
    entry.controller.abort()
    entry.notify()
    entry.unavailable()
  }, AUDIO_STALL_MS)
}

function startAudioDownload(request, entry) {
  entry.request = request
  const headers = new Headers(request.headers)
  headers.delete('range')
  headers.delete('if-range')
  resetAudioStall(entry)
  // 使用独立 signal，Audio 的探测结束、拖拽或取消某个 Range 都不取消完整下载。
  entry.headersReady = fetch(new Request(request, { headers, signal: entry.controller.signal })).then(response => {
    const size = Number(response.headers.get('content-length'))
    const range = response.headers.get('content-range')?.match(/^bytes 0-(\d+)\/(\d+)$/)
    const full = response.status === 200 || (response.status === 206 && range
      && Number(range[1]) + 1 === size && Number(range[2]) === size)
    const type = response.headers.get('content-type') || ''
    if (!full || !response.body || !/^(audio\/|application\/octet-stream)/i.test(type)
      || !Number.isSafeInteger(size) || size <= 0 || size > entry.limit) {
      // 无法确定大小或超出内存/离线容量时，首个请求仍可直接播放原始响应。
      // 后续请求走普通代理，不把未知/部分数据标记为完整缓存。
      entry.fallback = response
      entry.bypass = true
      entry.detach()
      entry.unavailable()
      clearTimeout(entry.stallTimer)
      if (request.signal.aborted) entry.controller.abort()
      else request.signal.addEventListener('abort', () => entry.controller.abort(), { once: true })
      return
    }
    entry.size = size
    entry.type = type
    entry.etag = response.headers.get('etag')
    entry.modified = response.headers.get('last-modified')
    resetAudioStall(entry)
    const reader = audioReader(response.body)
    entry.download = (async () => {
      try {
        while (!entry.error) {
          resetAudioStall(entry)
          const { value, done } = await reader.read()
          clearTimeout(entry.stallTimer)
          if (done) break
          if (entry.downloaded + value.byteLength > size) throw new Error('音频超过声明大小')
          for (let offset = 0; offset < value.byteLength; offset += AUDIO_CHUNK_BYTES) {
            const data = value.slice(offset, offset + AUDIO_CHUNK_BYTES)
            const chunk = { start: entry.downloaded, length: data.byteLength, key: entry.dataKey(entry.chunks.length), data: null }
            entry.chunks.push(chunk)
            if (entry.error) throw entry.error
            rememberChunk(chunk, data)
            entry.downloaded += data.byteLength
            entry.notify()
            await queueAudioWrite(entry, chunk, data)
          }
        }
        if (entry.error) throw entry.error
        if (entry.downloaded !== size) throw new Error('音频下载不完整')
        entry.complete = true
        entry.notify()
        await entry.diskDrain
        if (entry.commitRequested) await persistAudio(entry)
        if (!entry.cacheCancelled && !entry.persisted) {
          try { await audioWrite(entry, () => portComplete(entry)) } catch (error) {
            if (!entry.writesStopped) void reportAudioDiagnostic('write-manifest', error, entry.clientId)
            entry.unavailable()
          }
        }
      } catch (error) {
        entry.error = error
        entry.unavailable()
        entry.controller.abort()
      } finally {
        clearTimeout(entry.cacheTimer)
        clearTimeout(entry.stallTimer)
        entry.notify()
        reader.releaseLock()
      }
    })()
  }).catch(error => {
    entry.error = error
    entry.unavailable()
    clearTimeout(entry.stallTimer)
    entry.notify()
  })
}

async function portComplete(entry) {
  const headers = { 'content-type': entry.type, 'content-length': String(entry.size),
    ...(entry.etag ? { etag: entry.etag } : {}), ...(entry.modified ? { 'last-modified': entry.modified } : {}) }
  await (await caches.open(AUDIO_DATA_CACHE)).put(entry.stageKey,
    new Response(JSON.stringify(PROTOCOL.createManifest(entry.size, headers,
      entry.chunks.map(chunk => ({ key: chunk.key, length: chunk.length })))), {
      headers: { 'Content-Type': 'application/json' },
    }))
  if (entry.writesStopped) {
    await (await caches.open(AUDIO_DATA_CACHE)).delete(entry.stageKey)
    return
  }
  if (!entry.cacheCancelled && !entry.error) entry.port.postMessage({ type: MESSAGE.COMPLETE, cacheName: AUDIO_DATA_CACHE, cacheKey: entry.stageKey })
}

async function persistAudio(entry) {
  entry.commitRequested = true
  if (entry.persisting) return entry.persisting
  if (!entry.complete || !entry.cacheName || !entry.cacheKey) return
  entry.persisting = (async () => {
    const cache = await caches.open(entry.cacheName)
    const existing = await cache.match(entry.cacheKey)
    if (!existing || Number(existing.headers.get('content-length')) !== entry.size) return
    void existing.body?.cancel()
    const bodies = [...entry.bodies]
    const responses = await Promise.all(bodies.map(() => cache.match(entry.cacheKey)))
    if (responses.some(response => !response || Number(response.headers.get('content-length')) !== entry.size)) return
    if (entry.error) { for (const response of responses) void response.body?.cancel(); return }
    // 在删除临时块之前，为已存在的响应流取得独立的持久文件句柄。
    bodies.forEach((body, index) => { body.diskResponse = responses[index] })
    entry.persisted = true
    entry.notify()
    dropAudioMemory(entry)
    // 等待队列结束，避免清理后仍有分块写入；播放已切换到持久文件，不受影响。
    await entry.diskDrain
    await deleteAudioData(entry)
    entry.chunks = []
  })()
  try { await entry.persisting } finally { if (!entry.persisted) entry.persisting = null }
}

// 多区间/格式错误的 Range 按 HTTP 语义忽略；合法但越界的单区间返回 416。
function audioRange(header, size) {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) return null
  const first = Number(match[1])
  const last = Number(match[2])
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null
  const start = match[1] ? first : Math.max(0, size - last)
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1
  return start >= size || start > end || (!match[1] && last === 0) ? false : { start, end }
}

function audioBody(entry, start, end, signal) {
  let cursor = start
  let index = 0
  let cancelled = false
  let bodyCancelled = false
  const state = { diskResponse: null, diskReader: null }
  entry.bodies.add(state)
  const stop = () => {
    cancelled = true
    entry.bodies.delete(state)
    entry.notify()
    signal.removeEventListener('abort', stop)
    if (state.diskReader) void state.diskReader.cancel().catch(() => {})
    if (state.diskResponse) void state.diskResponse.body?.cancel().catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        if (cancelled) { if (!bodyCancelled) controller.close(); return }
        if (entry.error) { stop(); controller.error(entry.error); return }
        if (cursor > end) { stop(); controller.close(); return }
        if (entry.persisted || state.diskReader) {
          if (!state.diskReader) {
            const response = state.diskResponse || await (await caches.open(entry.cacheName)).match(entry.cacheKey)
            if (!response) { stop(); controller.error(new Error('已落盘的歌曲不可用')); return }
            state.diskResponse = null
            state.diskReader = sliceAudioStream(response, cursor, end, signal).getReader()
          }
          const next = await state.diskReader.read()
          if (cancelled) { if (!bodyCancelled) controller.close(); return }
          if (entry.error) { stop(); controller.error(entry.error); return }
          if (next.done) { stop(); controller.close(); return }
          cursor += next.value.byteLength
          controller.enqueue(next.value)
          return
        }
        if (cursor < entry.downloaded) {
          while (index < entry.chunks.length && entry.chunks[index].start + entry.chunks[index].length <= cursor) index++
          const chunk = entry.chunks[index]
          let bytes = chunk?.data || chunk?.pending
          if (!bytes && chunk) {
            try {
              const response = await (await caches.open(AUDIO_DATA_CACHE)).match(chunk.key)
              if (response && Number(response.headers.get('content-length')) === chunk.length) bytes = new Uint8Array(await response.arrayBuffer())
            } catch (error) {
              void reportAudioDiagnostic('read-chunk', error, entry.clientId)
              entry.diskFailed = true
              entry.unavailable()
            }
          }
          if (cancelled) { if (!bodyCancelled) controller.close(); return }
          if (entry.error) { stop(); controller.error(entry.error); return }
          if (entry.persisted) continue
          if (bytes && bytes.byteLength !== chunk.length) bytes = null
          if (!bytes) {
            // 临时存储配额/读取失败时，优先保证播放；只为剩余区间回退原生代理。
            entry.unavailable()
            const headers = new Headers(entry.request.headers)
            headers.set('range', `bytes=${cursor}-${end}`)
            const response = await fetch(new Request(entry.request, { headers, signal }))
            if (!response.ok) { stop(); controller.error(new Error('音频区间获取失败')); return }
            state.diskReader = sliceAudioStream(response, response.status === 206 ? 0 : cursor,
              response.status === 206 ? end - cursor : end, signal).getReader()
            continue
          }
          rememberChunk(chunk, bytes)
          const offset = cursor - chunk.start
          const data = bytes.subarray(offset, offset + Math.min(end - cursor + 1, bytes.byteLength - offset))
          cursor += data.byteLength
          controller.enqueue(data)
          return
        }
        await new Promise(resolve => entry.waiters.add(resolve))
      }
    },
    cancel() { bodyCancelled = true; stop() },
  })
}

async function serveAudio(request, entry) {
  await entry.headersReady
  if (entry.bypass) {
    const response = entry.fallback
    entry.fallback = null
    return response || fetch(request)
  }
  if (entry.error) return new Response(null, { status: 502 })
  if (entry.persisted) return restoreAudio(request, entry.clientId, new URL(entry.url))
  return audioResponse(request, entry, (start, end) => audioBody(entry, start, end, request.signal))
}

// Cache Storage 的文件只流式读取所需部分；不创建完整 Blob/ArrayBuffer。
function sliceAudioStream(response, start, end, signal) {
  const reader = audioReader(response.body)
  let offset = 0
  let remaining = end - start + 1
  let cancelled = false
  let bodyCancelled = false
  const stop = () => {
    cancelled = true
    signal.removeEventListener('abort', stop)
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!cancelled) {
          const { value, done } = await reader.read()
          if (cancelled) break
          if (done) { stop(); controller.error(new Error('音频缓存不完整')); return }
          const from = Math.max(0, start - offset)
          offset += value.byteLength
          if (from >= value.byteLength) continue
          const bytes = value.slice(from, from + Math.min(remaining, value.byteLength - from))
          remaining -= bytes.byteLength
          controller.enqueue(bytes)
          if (remaining === 0) { stop(); controller.close() }
          return
        }
        if (!bodyCancelled) controller.close()
      } catch (error) { stop(); if (!bodyCancelled) controller.error(error) }
    },
    cancel() { bodyCancelled = true; stop() },
  })
}

async function verifyStoredLength(response, size) {
  const reader = audioReader(response.body)
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return total === size
      total += value.byteLength
      if (total > size) return false
    }
  } finally { void reader.cancel().catch(() => {}) }
}

function audioResponse(request, entry, body) {
  const ifRange = request.headers.get('if-range')
  const range = audioRange(!ifRange || ifRange === entry.etag || ifRange === entry.modified
    ? request.headers.get('range') : null, entry.size)
  if (range === false) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${entry.size}` } })
  const { start, end } = range || { start: 0, end: entry.size - 1 }
  const headers = { 'Content-Type': entry.type, 'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${entry.size}`
  if (entry.etag) headers.ETag = entry.etag
  if (entry.modified) headers['Last-Modified'] = entry.modified
  return new Response(body(start, end), { status: range ? 206 : 200, headers })
}

async function restoreAudio(request, clientId, url) {
  try {
    const record = await withSessions(async () => sessionRecord(await caches.open(PLAYBACK_SESSIONS), sessionKey(clientId, url.href), clientId))
    if (record && validSession(record, url)) {
      const response = await (await caches.open(record.cacheName)).match(record.cacheKey)
      const size = Number(response?.headers.get('content-length'))
      const type = response?.headers.get('content-type') || ''
      let track
      if (response) {
        try { track = JSON.parse(decodeURIComponent(response.headers.get('x-holly-track') || '')) } catch (error) {
          void reportAudioDiagnostic('read-track-metadata', error, clientId)
        }
      }
      if (response?.status === 200 && Number.isSafeInteger(size) && size > 0
        && /^(audio\/|application\/octet-stream)/i.test(type)
        && track?.uid === url.searchParams.get('uid')
        && response.headers.get('x-holly-quality') === (url.searchParams.get('quality') || '320k')) {
        let stored = response
        // 新缓存由流式写入校验长度；兼容旧缓存时逐块校验，仍不整首载入内存。
        if (response.headers.get('x-holly-verified-size') !== String(size)) {
          const valid = await verifyStoredLength(response, size)
          if (!valid) void reportAudioDiagnostic('verify-audio', new Error('持久音频缓存长度不一致'), clientId)
          stored = valid ? await (await caches.open(record.cacheName)).match(record.cacheKey) : null
        }
        if (stored) return audioResponse(request, { size, type, etag: stored.headers.get('etag'),
          modified: stored.headers.get('last-modified') }, (start, end) => sliceAudioStream(stored, start, end, request.signal))
      }
      // 淘汰/清空/损坏后删除失效指针；绝不跨账号遍历其他歌曲缓存。
      await forgetSession(clientId, url.href, record.captureId)
    }
  } catch (error) {
    void reportAudioDiagnostic('restore-audio', error, clientId)
    // 存储不可用时保留原生网络播放路径。
  }
  return fetch(request)
}

function captureAudio(event, entry) {
  if (!entry.headersReady) startAudioDownload(event.request, entry)
  event.respondWith(serveAudio(event.request, entry))
  // 同步登记完整下载的生命周期；不能随短小的探测 Range 响应结束。
  event.waitUntil(entry.headersReady.then(() => entry.download).catch(() => {}))
}

self.addEventListener('install', event => {
  if (DEVELOPMENT) {
    event.waitUntil(self.skipWaiting())
    return
  }
  // 任一必需资源失败则保留旧 SW；更新等待所有旧页面关闭后生效，避免混用两个版本。
  event.waitUntil(caches.open(SHELL_CACHE).then(cache =>
    cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })))))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if (DEVELOPMENT) {
      await self.clients.claim()
      await pruneClosedAudio().catch(error => reportAudioDiagnostic('prune-audio', error))
      return
    }
    const keys = await caches.keys()
    await Promise.all(keys.filter(key =>
      (key.startsWith('holly-shell-') && key !== SHELL_CACHE)
      || /^holly-(static|pages)-v\d+$/.test(key)
    ).map(key => caches.delete(key)))
    await self.clients.claim()
    await pruneClosedAudio().catch(error => reportAudioDiagnostic('prune-audio', error))
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method === 'GET' && url.origin === self.location.origin && url.pathname === '/api/audio') {
    const entry = audioCaptures.get(`${event.clientId}:${url.href}`)
    if (entry) captureAudio(event, entry)
    else if (event.clientId) event.respondWith(restoreAudio(request, event.clientId, url))
    return
  }
  // Vite 开发环境只复用音频响应，页面、模块和 HMR 资源全部直接请求开发服务器。
  if (DEVELOPMENT) return
  if (request.headers.has('range') || request.headers.has('authorization') || request.destination === 'audio'
    || request.method !== 'GET' || url.origin !== self.location.origin
    || url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/')) return
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { signal: AbortSignal.timeout(4000) })
        if (response.ok || response.status < 500) return response
      } catch { /* 断网或超时，使用与缓存脚本一致的 HTML。 */ }
      const cache = await caches.open(SHELL_CACHE)
      return await cache.match('/') || Response.error()
    })())
    return
  }
  // 仅缓存构建清单里的公开资源，不把动态响应写进应用壳缓存。
  if (ASSETS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      return await cache.match(url.pathname) || fetch(request)
    })())
  }
})
