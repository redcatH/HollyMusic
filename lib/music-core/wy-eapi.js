// CommonJS版 eapi 加密，参考 src/renderer/utils/musicSdk/wy/utils/crypto.js
const { createCipheriv, createHash } = require('crypto')

const eapiKey = 'e82ckenh8dichen8'

const aesEncrypt = (buffer, mode, key, iv) => {
  const cipher = createCipheriv(mode, key, iv)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
}

const eapi = (url, object) => {
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = createHash('md5').update(message).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return {
    params: aesEncrypt(Buffer.from(data), 'aes-128-ecb', Buffer.from(eapiKey), '').toString('hex').toUpperCase(),
  }
}

module.exports = { eapi }
