/**
 * HTTP 请求模块 - 基于原项目的 request.js
 * 自动处理 JSON 解析，与原项目行为一致
 */

const needle = require('needle')

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}

/**
 * 底层请求函数 - 模仿原项目的 request 函数
 * 关键：自动将响应字符串解析为 JSON
 */
const request = (url, options, callback) => {
  let data
  if (options.body) {
    data = options.body
  } else if (options.form) {
    data = options.form
    options.json = false
  } else if (options.formData) {
    data = options.formData
    options.json = false
  }
  options.response_timeout = options.timeout

  return needle.request(options.method || 'get', url, data, options, (err, resp) => {
    if (!err) {
      // 关键代码：先转为字符串，再尝试解析 JSON
      let body = resp.body = resp.raw.toString()
      try {
        resp.body = JSON.parse(resp.body)
      } catch (_) {
        // 忽略 JSON 解析错误
      }
      body = resp.body
    }
    callback(err, resp, err ? null : resp.body)
  }).request
}

/**
 * 构建 Promise 形式的请求
 */
const buildHttpPromise = (url, options) => {
  let obj = {
    isCancelled: false,
    requestObj: null,
    cancelFn: null,
    cancelHttp: () => {
      if (!obj.requestObj) return obj.isCancelled = true
      if (obj.requestObj && obj.requestObj.abort) {
        obj.requestObj.abort()
      }
      obj.requestObj = null
      obj.promise = obj.cancelHttp = null
      if (obj.cancelFn) {
        obj.cancelFn(new Error('请求已取消'))
        obj.cancelFn = null
      }
    },
  }
  
  obj.promise = new Promise((resolve, reject) => {
    obj.cancelFn = reject
    
    const requestObj = request(url, {
      ...options,
      headers: Object.assign({}, defaultHeaders, options.headers || {}),
      timeout: options.timeout || 5000,
    }, (err, resp, body) => {
      obj.requestObj = null
      obj.cancelFn = null
      if (err) return reject(err)
      resolve(resp)
    })
    
    obj.requestObj = requestObj
    if (obj.isCancelled) obj.cancelHttp()
  })
  
  return obj
}

/**
 * HTTP Fetch - Promise 形式的请求（与原项目 httpFetch 行为一致）
 * @param {string} url - 请求地址
 * @param {object} options - 选项
 * @returns {object} { promise, cancelHttp }
 */
const httpFetch = (url, options = { method: 'get' }) => {
  const requestObj = buildHttpPromise(url, options)
  
  // 添加错误处理
  requestObj.promise = requestObj.promise.catch(err => {
    if (err.message === 'socket hang up') {
      return Promise.reject(new Error('服务器无法访问'))
    }
    switch (err.code) {
      case 'ETIMEDOUT':
      case 'ESOCKETTIMEDOUT':
        return Promise.reject(new Error('请求超时'))
      case 'ENOTFOUND':
        return Promise.reject(new Error('网络未连接'))
      default:
        return Promise.reject(err)
    }
  })
  
  return requestObj
}

/**
 * 简化的 httpFetch 包装 - 只返回 body
 * 使搜索模块代码更简洁
 */
const simpleFetch = async (url, options = {}) => {
  const requestObj = httpFetch(url, options)
  const resp = await requestObj.promise
  return resp.body
}

module.exports = {
  httpFetch,      // 原始 httpFetch，返回 { promise, cancelHttp }
  simpleFetch,    // 简化版本，直接返回 body
  request,        // 底层 request 函数
}
