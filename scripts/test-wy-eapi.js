#!/usr/bin/env node
// scripts/test-wy-eapi.js
// Server-side smoke test for wy-eapi: generate params and POST to 网易 eapi batch endpoint

const needle = require('needle')
const path = require('path')

// load eapi (server-side CommonJS)
const { eapi } = require(path.join(__dirname, '..', 'lib', 'music-core', 'wy-eapi'))

async function tryPost(url, bodyStr, headers) {
  return new Promise((resolve) => {
    needle.post(url, bodyStr, { headers, timeout: 15000 }, (err, resp, body) => {
      if (err) return resolve({ err })
      return resolve({ resp, body })
    })
  })
}

async function runTest() {
  try {
    // Try a cloudsearch payload (known working endpoint for batch eapi)
    const apiPath = '/api/cloudsearch/pc'
    const payload = {
      s: '周杰伦',
      type: 1,
      limit: 1,
      total: true,
      offset: 0,
    }

    const formObj = eapi(apiPath, payload)
    const hexUpper = (formObj.params || '')
    const hexLower = hexUpper.toLowerCase()

    console.log('[wy-eapi] Generated params length:', hexUpper.length)

    const attempts = []

    const headersBase = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Origin': 'https://music.163.com',
      'Referer': 'https://music.163.com/',
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    const endpoints = [
      'http://interface.music.163.com/eapi/batch',
      'https://music.163.com/eapi/batch',
      'https://interface.music.163.com/eapi/batch',
    ]

    // build candidate request bodies
    const bodies = [
      { desc: 'UPPER params', str: new URLSearchParams({ params: hexUpper }).toString() },
      { desc: 'lower params', str: new URLSearchParams({ params: hexLower }).toString() },
      { desc: 'UPPER + csrf', str: new URLSearchParams({ params: hexUpper, csrf_token: '' }).toString() },
      { desc: 'lower + csrf', str: new URLSearchParams({ params: hexLower, csrf_token: '' }).toString() },
    ]

    for (const url of endpoints) {
      for (const body of bodies) {
        attempts.push({ url, body })
      }
    }

    for (const attempt of attempts) {
      console.log('[wy-eapi] Trying:', attempt.url, attempt.body.desc)
      const { url, body } = attempt
      const result = await tryPost(url, body.str, headersBase)
      if (result.err) {
        console.error('[wy-eapi] Request error:', result.err && result.err.message)
        continue
      }

      const { resp, body: respBody } = result
      console.log('[wy-eapi] HTTP status:', resp && resp.statusCode)

      // Ensure we have a parsed object (needle may return string)
      let parsed = respBody
      if (typeof respBody === 'string') {
        try {
          parsed = JSON.parse(respBody)
        } catch {
          // keep as string if not JSON
          console.log('[wy-eapi] Response body (raw string, not JSON)')
        }
      }

      try {
        console.log('[wy-eapi] Response body:', typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : parsed)
      } catch (err) {
        console.log('[wy-eapi] Response body (raw)', parsed, 'err:', err && err.message)
      }

      const rawCode = parsed && (parsed.code ?? (parsed.result && parsed.result.code))
      const codeNum = Number(rawCode)
      if (codeNum === 200) {
        console.log('[wy-eapi] SUCCESS on:', url, body.desc)
        process.exit(0)
      }
    }

    console.error('[wy-eapi] All attempts failed; received parameter error or non-200 response')
    process.exit(3)
  } catch (e) {
    console.error('[wy-eapi] Error generating params or sending request:', e && e.message)
    console.error(e && e.stack)
    process.exit(4)
  }
}

runTest()
