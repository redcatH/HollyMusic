'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const vm = require('node:vm')

// Exchange only primitive strings across the VM boundary. Request resolvers stay inside the VM.
const bootstrap = new vm.Script(`(() => {
  let definition
  let registrationOpen = true
  let result
  const requests = []
  const resolvers = new Map()
  const parse = JSON.parse.bind(JSON)
  const stringify = JSON.stringify.bind(JSON)
  let counter = 0
  let httpCount = 0
  let storageCount = 0
  const HEADER_NAME = /^[!#$%&'*+.^_|~0-9A-Za-z-]{1,64}$/
  // Validate options inside the VM so only plain data crosses the boundary.
  function requestOptions(options) {
    const responseType = options.responseType === undefined ? 'json' : options.responseType
    if (responseType !== 'json' && responseType !== 'text') throw new Error('请求选项无效')
    const headers = {}
    if (options.headers !== undefined) {
      if (!options.headers || typeof options.headers !== 'object' || Array.isArray(options.headers)) throw new Error('请求选项无效')
      const entries = Object.entries(options.headers)
      if (entries.length > 16) throw new Error('请求选项无效')
      for (const entry of entries) {
        if (typeof entry[1] !== 'string' || entry[1].length > 8192 || !HEADER_NAME.test(entry[0])) throw new Error('请求选项无效')
        headers[entry[0]] = entry[1]
      }
    }
    return { method: options.method || 'GET', body: options.body, headers, responseType }
  }
  const storageKey = (key) => {
    if (typeof key !== 'string' || !/^[\\w.-]{1,128}$/.test(key)) throw new Error('存储键无效')
    return key
  }
  Object.defineProperty(globalThis, 'holly', { value: Object.freeze({ register(value) {
    if (!registrationOpen || definition || !value || !Array.isArray(value.platforms)) throw new Error('脚本必须注册一个平台包')
    definition = value
  } }) })

  return {
    manifest() {
      registrationOpen = false
      if (!definition) throw new Error('脚本未注册平台包')
      return stringify({ apiVersion: definition.apiVersion, id: definition.id, name: definition.name, version: definition.version,
        platforms: definition.platforms.map(platform => ({ id: platform.id, name: platform.name, origins: platform.origins,
          capabilities: Object.keys(platform.handlers || {}).filter(key => typeof platform.handlers[key] === 'function') })) })
    },
    start(platformId, capability, rawInput) {
      const platform = definition.platforms.find(item => item.id === platformId)
      if (!platform || !Object.hasOwn(platform.handlers, capability)) throw new Error('未注册此功能')
      // Both request kinds share one id space; the host replies through the same resolver map.
      const enqueue = (message, resolve, reject) => {
        const id = ++counter
        requests.push(stringify({ id, ...message }))
        resolvers.set(id, { resolve, reject })
      }
      const request = (url, options = {}) => new Promise((resolve, reject) => {
        let prepared
        try {
          if (typeof url !== 'string' || httpCount >= 12) throw new Error('请求不符合限制')
          prepared = requestOptions(options)
        } catch (error) { reject(error); return }
        httpCount++
        enqueue({ kind: 'http', url, options: prepared }, resolve, reject)
      })
      // build() throwing inside the executor rejects without enqueueing anything.
      const operate = (build) => new Promise((resolve, reject) => {
        if (storageCount >= 64) { reject(new Error('插件存储操作次数超过限制')); return }
        storageCount++
        enqueue({ kind: 'storage', packageId: definition.id, operation: build() }, resolve, reject)
      })
      const storage = Object.freeze({
        get: (key) => operate(() => ({ type: 'get', key: storageKey(key) })),
        set: (key, value, options = {}) => operate(() => {
          if (typeof value !== 'string' || typeof options !== 'object' || options === null) throw new Error('存储值无效')
          return { type: 'set', key: storageKey(key), value, ttl: options.ttl }
        }),
        delete: (key) => operate(() => ({ type: 'delete', key: storageKey(key) })),
      })
      Promise.resolve().then(() => platform.handlers[capability](parse(rawInput), Object.freeze({ platform: platformId, request, storage })))
        .then(value => { result = stringify({ value }) })
        .catch(() => { result = stringify({ error: true }) })
    },
    next() { return requests.shift() },
    reply(id, raw, failure) {
      const callbacks = resolvers.get(id)
      if (!callbacks) return
      resolvers.delete(id)
      if (failure) {
        // status is the upstream HTTP code, or 0 when the request never completed.
        const error = new Error(failure.message)
        error.status = failure.status
        callbacks.reject(error)
      } else callbacks.resolve(parse(raw))
    },
    result() { return result },
  }
})()`)

const unavailable = (_operation, callback) => callback(new Error('插件存储不可用'))

// transport(url, options, callback) and storage(operation, callback) each report (error, value).
async function runPlatformJob(job, transport, storage = unavailable) {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })
  const bridge = bootstrap.runInContext(context, { timeout: 1000 })
  new vm.Script('"use strict";\n' + job.content, { filename: 'platform-plugin.js' }).runInContext(context, { timeout: 1000 })
  const manifest = JSON.parse(bridge.manifest())
  if (job.action === 'platformInspect') return manifest

  bridge.start(job.platform, job.capability, JSON.stringify(job.input))
  for (;;) {
    const result = bridge.result()
    if (result !== undefined) {
      const packet = JSON.parse(result)
      if (packet.error || packet.value === undefined) throw new Error('平台插件返回失败')
      return packet.value
    }
    let raw
    while ((raw = bridge.next()) !== undefined) {
      const message = JSON.parse(raw)
      if (message.kind === 'storage') {
        storage({ platform: job.platform, packageId: message.packageId, operation: message.operation }, (error, value) => {
          if (error) bridge.reply(message.id, '', { message: '插件存储操作被拒绝', status: 0 })
          else bridge.reply(message.id, JSON.stringify(value === undefined ? null : value), null)
        })
        continue
      }
      const { id, url, options } = message
      const text = options.responseType === 'text'
      transport(url, options, (error, response) => {
        const failure = (status) => bridge.reply(id, '', { message: '上游请求失败或被网络策略阻止', status })
        if (error) return failure(0)
        // Text mode keeps the raw body for pages and scripts that are not JSON.
        const body = text ? String(response.raw ? response.raw.toString('utf8') : response.body) : response.body
        if (response.statusCode < 200 || response.statusCode >= 300 || (!text && typeof body === 'string')) return failure(response.statusCode)
        // reply() parses its argument, so both kinds travel as JSON.
        bridge.reply(id, JSON.stringify(body), null)
      })
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

module.exports = { runPlatformJob }
