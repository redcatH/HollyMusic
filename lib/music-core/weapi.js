const crypto = require('crypto')

const presetKey = '0CoJUm6Qyw8W8jud'
const iv = '0102030405060708'
const pubKey = '010001'
const modulus = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725' +
  '152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c938701' +
  '1b8e58d2f3e6f44a8b5f2fa9b3d5a0b9b1e8f6a2b8f3f1f7b5d3c4f9e7a1f3c2b'

function aesEncrypt(text, secKey) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(secKey, 'utf8'), Buffer.from(iv, 'utf8'))
  cipher.setAutoPadding(true)
  let encrypted = cipher.update(text, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  return encrypted
}

function toHex(str) {
  return Buffer.from(str, 'utf8').toString('hex')
}

function randomKey(size = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let key = ''
  const buf = crypto.randomBytes(size)
  for (let i = 0; i < size; i++) key += chars[buf[i] % chars.length]
  return key
}

function rsaEncrypt(secKey) {
  // reverse
  const reversed = secKey.split('').reverse().join('')
  const hexReversed = toHex(reversed)
  const bigNum = BigInt('0x' + hexReversed)
  const exp = BigInt('0x' + pubKey)
  const mod = BigInt('0x' + modulus)
  const result = bigNum ** exp % mod
  let hex = result.toString(16)
  while (hex.length < 256) hex = '0' + hex
  return hex
}

function weapi(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data)
  const secKey = randomKey(16)
  const encText = aesEncrypt(aesEncrypt(text, presetKey), secKey)
  const encSecKey = rsaEncrypt(secKey)
  return { params: encText, encSecKey }
}

module.exports = { weapi }
