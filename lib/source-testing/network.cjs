'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const http = require('node:http')
const https = require('node:https')
const dns = require('node:dns/promises')
const net = require('node:net')
const { isIP } = require('node:net')

// Only globally routable unicast addresses. IPv4-mapped IPv6 is deliberately rejected.
function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0))
  }
  if (isIP(address) === 6) {
    const first = parseInt(address.split(':')[0], 16)
    const second = parseInt(address.split(':')[1], 16) || 0
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && second < 0x200) && !address.toLowerCase().startsWith('2001:db8:')
  }
  return false
}

async function resolvePublicUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 8192) {
    throw new Error('仅允许不含账号信息的公网 HTTP(S) 地址')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true })
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('已阻止本机、内网或保留地址请求')
  return { url, address: addresses[0] }
}

/** Pin the checked DNS answer to the socket, recheck each redirect, bound streamed bytes. */
async function publicRequest(value, options = {}) {
  const { maxBytes = 2 * 1024 * 1024, partial = false, signal, method = 'GET', body, headers = {} } = options
  let current = value
  const deadline = Date.now() + Math.min(options.timeout || 15000, 60000)
  for (let hop = 0; hop <= 3; hop++) {
    signal?.throwIfAborted()
    let dnsTimer
    const resolved = await Promise.race([
      resolvePublicUrl(current),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('地址解析超时')), Math.max(1, deadline - Date.now())); dnsTimer.unref() }),
    ]).finally(() => clearTimeout(dnsTimer))
    const { url, address } = resolved
    const result = await new Promise((resolve, reject) => {
      const safeHeaders = {}
      for (const [key, val] of Object.entries(headers)) {
        if (!['host', 'connection', 'transfer-encoding', 'content-length', 'upgrade', 'proxy-authorization', 'accept-encoding'].includes(key.toLowerCase())) safeHeaders[key] = String(val)
      }
      safeHeaders['accept-encoding'] = 'identity'
      const request = (url.protocol === 'https:' ? https : http).request(url, {
        method, headers: safeHeaders, signal, agent: false,
        lookup: (_host, opts, callback) => callback(null, opts?.all ? [address] : address.address, address.family),
      }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.destroy()
          resolve({ redirect: new URL(response.headers.location, url).href })
          return
        }
        let size = 0
        const chunks = []
        let done = false
        const finish = (complete) => {
          if (done) return
          done = true
          resolve({ status: response.statusCode, headers: response.headers, data: Buffer.concat(chunks), complete })
        }
        response.on('data', chunk => {
          const remaining = maxBytes - size
          chunks.push(chunk.subarray(0, remaining))
          size += Math.min(chunk.length, remaining)
          if (chunk.length > remaining) {
            if (partial) finish(false)
            else { done = true; reject(new Error('响应超过大小限制')) }
            response.destroy()
          }
        })
        response.on('end', () => finish(true))
        response.on('error', error => { if (!done) reject(error) })
        response.on('aborted', () => { if (!done) reject(new Error('音频传输中断')) })
      })
      const timer = setTimeout(() => request.destroy(new Error('网络请求超时')), Math.max(1, deadline - Date.now()))
      request.on('close', () => clearTimeout(timer))
      request.on('error', reject)
      if (body) request.write(body)
      request.end()
    })
    if (!result.redirect) return result
    // Never forward a credential-bearing POST across redirects.
    if (method !== 'GET' && method !== 'HEAD') throw new Error('不允许重定向带请求体的请求')
    if (new URL(result.redirect).origin !== url.origin) {
      delete headers.Authorization
      delete headers.authorization
      delete headers.Cookie
      delete headers.cookie
    }
    current = result.redirect
  }
  throw new Error('重定向次数过多')
}

module.exports = { isPublicAddress, resolvePublicUrl, publicRequest }
