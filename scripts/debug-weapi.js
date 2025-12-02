const needle = require('needle')
const { weapi } = require('../lib/music-core/weapi')

async function run() {
  const form = weapi({})
  const bodyStr = `params=${encodeURIComponent(form.params)}&encSecKey=${encodeURIComponent(form.encSecKey)}`
  const urls = [
    'https://music.163.com/weapi/playlist/catalogue',
    'https://music.163.com/api/playlist/catlist',
    'https://music.163.com/weapi/playlist/hottags',
  ]
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Referer: 'https://music.163.com/',
    Origin: 'https://music.163.com',
    Accept: '*/*',
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  for (const url of urls) {
    console.log('\nPOST', url)
    try {
      const resp = await new Promise((resolve, reject) => {
        needle.post(url, bodyStr, { headers, timeout: 10000 }, (err, resp) => {
          if (err) return reject(err)
          resolve(resp)
        })
      })
      console.log('statusCode:', resp.statusCode)
      console.log('headers:', resp.headers)
      if (resp.raw) console.log('raw length:', resp.raw.length)
      try {
        console.log('body (first 1000):', JSON.stringify(resp.body).slice(0, 1000))
      } catch (e) {
        console.log('body (first 1000):', String(resp.body).slice(0, 1000))
      }
    } catch (e) {
      console.error('request error', e && e.message)
    }
  }
}

run()
