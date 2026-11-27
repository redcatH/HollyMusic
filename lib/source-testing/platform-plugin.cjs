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
      const request = (url, options = {}) => new Promise((resolve, reject) => {
        if (typeof url !== 'string' || counter >= 12) { reject(new Error('请求不符合限制')); return }
        const id = ++counter
        const method = options.method || 'GET'
        requests.push(stringify({ id, url, options: { method, body: options.body } }))
        resolvers.set(id, { resolve, reject })
      })
      Promise.resolve().then(() => platform.handlers[capability](parse(rawInput), Object.freeze({ platform: platformId, request })))
        .then(value => { result = stringify({ value }) })
        .catch(() => { result = stringify({ error: true }) })
    },
    next() { return requests.shift() },
    reply(id, raw, failed) {
      const callbacks = resolvers.get(id)
      if (!callbacks) return
      resolvers.delete(id)
      if (failed) callbacks.reject(new Error('上游请求失败或被网络策略阻止'))
      else callbacks.resolve(parse(raw))
    },
    result() { return result },
  }
})()`)

async function runPlatformJob(job, transport) {
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
      const { id, url, options } = JSON.parse(raw)
      transport(url, options, (error, response) => {
        if (error || response.statusCode < 200 || response.statusCode >= 300 || typeof response.body === 'string') {
          bridge.reply(id, '', true)
        } else {
          bridge.reply(id, JSON.stringify(response.body), false)
        }
      })
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

module.exports = { runPlatformJob }
