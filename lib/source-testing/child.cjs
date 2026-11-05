'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

// One disposable Node process per operation. Scripts execute in the shared LX VM engine.
// All LX HTTP requests cross this bounded protocol to the parent's controlled network bridge.
const readline = require('node:readline')
const pending = new Map()
let sequence = 0
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
global.console = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'].map(key => [key, () => {}]))

function transport(url, options, callback) {
  const id = ++sequence
  pending.set(id, callback)
  emit({ type: 'request', id, url, options })
  return () => pending.delete(id)
}

async function run(job) {
  if (job.action === 'analyze') {
    const { parseBuffer } = await import('music-metadata')
    const metadata = await parseBuffer(Buffer.from(job.audio, 'base64'), undefined, { duration: true, skipCovers: true })
    const f = metadata.format
    return { codec: f.codec || f.container || null, duration: f.duration || null, sampleRate: f.sampleRate || null,
      bitsPerSample: f.bitsPerSample || null, bitrate: f.bitrate || null, lossless: f.lossless ?? null, channels: f.numberOfChannels || null }
  }
  const Simulator = require('../music-core/index')
  const sim = new Simulator({ requestTransport: transport })
  try {
    const info = await sim.executeScript(job.content)
    if (job.action === 'inspect') return { info, name: sim.parseScriptInfo(job.content).name }
    const url = await sim.getMusicUrl(job.platform, job.song, job.quality)
    if (typeof url !== 'string' || url.length > 8192) throw new Error('音源未返回有效播放地址')
    return { url }
  } finally { sim.dispose() }
}

let started = false
readline.createInterface({ input: process.stdin }).on('close', () => process.exit(0)).on('line', line => {
  try {
    const message = JSON.parse(line)
    if (message.type === 'response') {
      const callback = pending.get(message.id)
      pending.delete(message.id)
      if (!callback) return
      if (message.error) callback(new Error(message.error))
      else {
        const raw = Buffer.from(message.data, 'base64')
        let body = raw.toString('utf8')
        try { body = JSON.parse(body) } catch { /* text response */ }
        callback(null, { statusCode: message.status, headers: message.headers, raw, body, bytes: raw.length })
      }
    } else if (!started) {
      started = true
      run(message).then(value => { process.stdout.write(JSON.stringify({ type: 'result', value }) + '\n', () => process.exit(0)) }, () => {
        process.stdout.write(JSON.stringify({ type: 'error', error: '脚本执行或音频解析失败' }) + '\n', () => process.exit(1))
      })
    }
  } catch { process.exit(1) }
})
