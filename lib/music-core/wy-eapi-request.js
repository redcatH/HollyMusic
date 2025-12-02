const { httpFetch } = require('./request')
const { eapi } = require('./wy-eapi')

const defaultHosts = [
  'https://music.163.com/eapi',
  'https://interface3.music.163.com/eapi',
  'https://interface2.music.163.com/eapi',
]

function eapiRequest(path, data = {}, opts = {}) {
  let idx = 0
  let currentReq = null
  const hosts = opts.hosts || defaultHosts

  const tryOne = () => {
    if (idx >= hosts.length) return Promise.reject(new Error('all hosts failed'))
    const host = hosts[idx++]
    const url = host + path
    const body = eapi(path, data)
    currentReq = httpFetch(url, {
      method: 'post',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, opts.headers || {}),
      form: body,
      timeout: opts.timeout || 8000,
    })
    return currentReq.promise.then(({ statusCode, body: respBody }) => {
      if (statusCode !== 200) return tryOne()
      // some endpoints return body with code property
      if (respBody && typeof respBody.code !== 'undefined' && respBody.code !== 200) {
        // try next host
        return tryOne()
      }
      return { body: respBody, statusCode }
    }).catch(err => {
      // try next host on error
      return tryOne()
    })
  }

  const promise = tryOne()

  return {
    promise,
    cancelHttp: () => { if (currentReq && typeof currentReq.cancelHttp === 'function') currentReq.cancelHttp() },
  }
}

module.exports = { eapiRequest }
