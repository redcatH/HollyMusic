/**
 * LX Music 自定义源环境模拟器
 * 可以直接运行 LX Music 的自定义源脚本
 *
 * 安全模型（对齐 lx-music-desktop 原版 userApi 窗口）：
 * 脚本在 vm 沙箱中执行（见 ./sandbox.js），只能访问 lx API 与浏览器式
 * 全局；require / process / Buffer 全局 / module 等一律不可见。
 * 与真实洛雪客户端行为一致——依赖 Node 环境的脚本本就无法在洛雪中运行。
 */

const needle = require('needle')
const { createCipheriv, publicEncrypt, constants, randomBytes: _randomBytes, createHash } = require('crypto')
const { inflate: _inflate, deflate: _deflate } = require('zlib')
const { existsSync, readFileSync } = require('fs')
const { createScriptSandbox } = require('./sandbox')

class LXEnvironmentSimulator {
  constructor() {
    this.events = {}
    this.isInitialized = false
    this.sourceInfo = null
    this.proxy = {
      host: '',
      port: '',
    }
    this.sandbox = null
  }

  /**
   * 创建脚本沙箱并注入 lx API（每次执行脚本时重建，互不残留）。
   * 返回 { env, lx }，lx 为沙箱域对象树。
   */
  createScriptSandboxEnv() {
    const self = this
    const env = createScriptSandbox({})

    /** 沙箱字节 → 宿主 Buffer；字符串保持原样（crypto/buffer API 入参用）。 */
    const toHostBuffer = (value) =>
      typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(env.toHostValue(value))

    const lx = env.newObject()

    // 事件名称常量
    lx.EVENT_NAMES = env.toData({
      request: 'request',
      inited: 'inited',
      updateAlert: 'updateAlert',
    })

    // API 版本
    lx.version = '2.12.2'

    // 运行环境
    lx.env = 'desktop'

    // 当前脚本信息（每次执行前由 executeScript 更新）
    lx.currentScriptInfo = env.newObject()

    /**
     * HTTP 请求方法
     * @param {string} url - 请求 URL
     * @param {object} options - 请求选项（沙箱对象，宿主侧降维拷贝）
     * @param {function} callback - 沙箱回调 (err, resp, body)
     * @returns {function} 取消请求的函数（沙箱域包装）
     */
    lx.request = env.wrapFn(function hostRequest(url, options, callback) {
      const hostOptions = env.toHostValue(options) || {}
      const {
        method = 'get',
        timeout = 5000,
        headers = {},
        body,
        form,
        formData,
      } = hostOptions

      console.log(`[HTTP] Request: ${method.toUpperCase()} ${url}`)

      let data
      let requestOptions = {
        headers,
        response_timeout: Math.min(timeout, 60000),
        json: true,
      }

      // 处理不同类型的请求数据
      if (body) {
        data = body
      } else if (form) {
        data = form
        requestOptions.json = false
      } else if (formData) {
        data = formData
        requestOptions.json = false
      }

      // 处理代理
      if (self.proxy.host) {
        requestOptions.agent = self.getRequestAgent(url)
      }

      const request = needle.request(
        method,
        url,
        data,
        requestOptions,
        (err, resp) => {
          if (err) {
            console.error(`[HTTP Error] ${err.message}`)
            callback(env.sandboxError(err), null, null)
            return
          }

          let bodyData = resp.body
          if (typeof bodyData === 'string') {
            try {
              bodyData = JSON.parse(bodyData)
            } catch {}
          }

          // 响应对象在沙箱域组装；raw 转沙箱字节，其余经 JSON 桥
          const respSandbox = env.newObject()
          respSandbox.statusCode = resp.statusCode
          respSandbox.statusMessage = resp.statusMessage
          respSandbox.headers = env.toData(resp.headers || {})
          respSandbox.bytes = resp.bytes
          respSandbox.raw = env.toBytes(resp.raw || Buffer.alloc(0))
          respSandbox.body =
            bodyData !== null && typeof bodyData === 'object' ? env.toData(bodyData) : bodyData

          callback(null, respSandbox, respSandbox.body)
        }
      ).request

      // 返回取消函数（wrapFn 'fn' 策略会包装为沙箱域函数）
      return () => {
        if (request && !request.aborted) {
          request.abort()
        }
      }
    }, 'fn')

    /**
     * 注册事件监听器
     * @param {string} eventName - 事件名称
     * @param {function} handler - 沙箱事件处理函数（宿主侧保留引用直接调用）
     * @returns {Promise}
     */
    lx.on = env.wrapFn(function hostOn(eventName, handler) {
      return new Promise((resolve, reject) => {
        const validEvents = ['request', 'inited', 'updateAlert']
        if (!validEvents.includes(eventName)) {
          return reject(new Error(`不支持的事件: ${eventName}`))
        }

        if (eventName === 'request') {
          self.events.request = handler
          console.log('[Event] 已注册 request 事件处理器')
        }

        resolve()
      })
    }, 'promise')

    /**
     * 发送事件
     * @param {string} eventName - 事件名称
     * @param {*} data - 事件数据（沙箱对象，宿主侧降维拷贝保存）
     * @returns {Promise}
     */
    lx.send = env.wrapFn(function hostSend(eventName, data) {
      return new Promise((resolve, reject) => {
        const validEvents = ['request', 'inited', 'updateAlert']
        if (!validEvents.includes(eventName)) {
          return reject(new Error(`不支持的事件: ${eventName}`))
        }

        switch (eventName) {
          case 'inited':
            if (self.isInitialized) {
              return reject(new Error('脚本已经初始化'))
            }
            self.isInitialized = true
            self.sourceInfo = env.toHostValue(data)
            console.log('[Init] 自定义源初始化成功:', JSON.stringify(self.sourceInfo, null, 2))
            resolve()
            break

          case 'updateAlert':
            console.log('[Update Alert]', data && data.log)
            if (data && data.updateUrl) {
              console.log('[Update URL]', data.updateUrl)
            }
            resolve()
            break

          default:
            reject(new Error(`未知事件: ${eventName}`))
        }
      })
    }, 'promise')

    // 工具函数集合
    const utils = env.newObject()

    // 加密相关
    const crypto = env.newObject()

    /** AES 加密：入参支持沙箱字节或字符串，返回沙箱字节 */
    crypto.aesEncrypt = env.wrapFn(function hostAesEncrypt(buffer, mode, key, iv) {
      const cipher = createCipheriv(String(mode), toHostBuffer(key), iv == null ? null : toHostBuffer(iv))
      return Buffer.concat([cipher.update(toHostBuffer(buffer)), cipher.final()])
    }, 'bytes')

    /** RSA 加密（RSA_NO_PADDING，左侧零填充到 128 字节） */
    crypto.rsaEncrypt = env.wrapFn(function hostRsaEncrypt(buffer, key) {
      const hostBuffer = toHostBuffer(buffer)
      return publicEncrypt(
        {
          key: String(key),
          padding: constants.RSA_NO_PADDING,
        },
        Buffer.concat([Buffer.alloc(128 - hostBuffer.length), hostBuffer])
      )
    }, 'bytes')

    /** 生成随机字节 */
    crypto.randomBytes = env.wrapFn((size) => _randomBytes(Number(size) || 0), 'bytes')

    /** MD5 哈希 */
    crypto.md5 = env.wrapFn((str) => createHash('md5').update(String(str)).digest('hex'), 'data')

    // Buffer 操作（字节以沙箱 Uint8Array 形态过界）
    const bufferApi = env.newObject()
    bufferApi.from = env.wrapFn(function hostBufferFrom(...args) {
      const first = args[0]
      if (typeof first === 'string') {
        return Buffer.from(first, typeof args[1] === 'string' ? args[1] : 'utf8')
      }
      return Buffer.from(env.toHostValue(first))
    }, 'bytes')
    bufferApi.bufToString = env.wrapFn(
      (buf, format) => Buffer.from(env.toHostValue(buf)).toString(String(format)),
      'data'
    )

    // 压缩相关
    const zlib = env.newObject()
    zlib.inflate = env.wrapFn(
      (buf) =>
        new Promise((resolve, reject) => {
          _inflate(Buffer.from(env.toHostValue(buf)), (err, data) => {
            if (err) reject(new Error(err.message))
            else resolve(data)
          })
        }),
      'promiseBytes'
    )
    zlib.deflate = env.wrapFn(
      (data) =>
        new Promise((resolve, reject) => {
          _deflate(Buffer.from(env.toHostValue(data)), (err, buf) => {
            if (err) reject(new Error(err.message))
            else resolve(buf)
          })
        }),
      'promiseBytes'
    )

    utils.crypto = crypto
    utils.buffer = bufferApi
    utils.zlib = zlib
    lx.utils = utils

    env.setGlobal('lx', lx)
    return { env, lx }
  }

  /**
   * 释放沙箱资源（清理脚本注册的定时器）。
   * 音源实例被重载或销毁时调用，避免孤儿 interval。
   */
  dispose() {
    if (this.sandbox) {
      try {
        this.sandbox.dispose()
      } catch {}
      this.sandbox = null
    }
  }

  /**
   * 获取代理 Agent
   */
  getRequestAgent(url) {
    if (!this.proxy.host) return undefined

    const { httpOverHttp, httpsOverHttp } = require('tunnel')
    const httpsRxp = /^https:/

    const tunnelFunc = httpsRxp.test(url) ? httpsOverHttp : httpOverHttp
    return tunnelFunc({
      proxy: {
        host: this.proxy.host,
        port: this.proxy.port,
      },
    })
  }

  /**
   * 设置代理
   * @param {string} host - 代理主机
   * @param {string|number} port - 代理端口
   */
  setProxy(host, port) {
    this.proxy.host = host
    this.proxy.port = String(port)
    console.log(`[Proxy] 已设置代理: ${host}:${port}`)
  }

  /**
   * 解析脚本头部信息
   * @param {string} script - 脚本内容
   * @returns {object}
   */
  parseScriptInfo(script) {
    const match = /^\/\*[\S|\s]+?\*\//.exec(script)
    const header = match ? match[0] : ''

    if (!header) {
      // 如果脚本没有头部注释，则返回默认的空信息，而非抛出错误
      return {
        name: '',
        description: '',
        version: '',
        author: '',
        homepage: '',
      }
    }

    const infoArr = header.split(/\r?\n/)
    const rxp = /^\s?\*\s?@(\w+)\s(.+)$/
    const infos = {
      name: '',
      description: '',
      version: '',
      author: '',
      homepage: '',
    }

    for (const line of infoArr) {
      const match = rxp.exec(line)
      if (!match) continue

      const key = match[1]
      if (infos.hasOwnProperty(key)) {
        infos[key] = match[2].trim()
      }
    }

    return infos
  }

  /**
   * 加载并执行自定义源脚本
   * @param {string} scriptPath - 脚本文件路径
   * @returns {Promise}
   */
  async loadScript(scriptPath) {
    console.log(`\n[Load] 正在加载脚本: ${scriptPath}`)

    if (!existsSync(scriptPath)) {
      throw new Error(`脚本文件不存在: ${scriptPath}`)
    }

    const scriptContent = readFileSync(scriptPath, 'utf8')
    return this.executeScript(scriptContent)
  }

  /**
   * 执行自定义源脚本（vm 沙箱内）
   * @param {string} scriptContent - 脚本内容
   * @returns {Promise}
   */
  async executeScript(scriptContent) {
    // 解析脚本信息
    const scriptInfo = this.parseScriptInfo(scriptContent)
    console.log('[Script Info]', scriptInfo)

    // 重建沙箱（同一实例重载脚本时清掉旧环境与旧状态）
    if (this.sandbox) {
      try {
        this.sandbox.dispose()
      } catch {}
    }
    this.events = {}
    this.isInitialized = false
    this.sourceInfo = null
    const { env, lx } = this.createScriptSandboxEnv()
    this.sandbox = env

    // 反篡改脚本会读取 rawScript 与自身比对，必须完整提供
    lx.currentScriptInfo.name = scriptInfo.name
    lx.currentScriptInfo.description = scriptInfo.description
    lx.currentScriptInfo.version = scriptInfo.version
    lx.currentScriptInfo.author = scriptInfo.author
    lx.currentScriptInfo.homepage = scriptInfo.homepage
    lx.currentScriptInfo.rawScript = scriptContent

    // 创建错误捕获
    let initError = null
    let errorDetails = []

    const errorHandler = (error) => {
      if (!this.isInitialized) {
        initError = error
        errorDetails.push({
          message: error.message,
          stack: error.stack,
        })
        console.error('[Init Error]', error.message)
        if (error.stack) {
          console.error('[Stack]', error.stack)
        }
      }
    }

    const rejectionHandler = (reason) => {
      if (!this.isInitialized) {
        const error = reason instanceof Error ? reason : new Error(String(reason))
        initError = error
        errorDetails.push({
          message: error.message,
          stack: error.stack,
        })
        console.error('[Unhandled Rejection]', error.message)
        if (error.stack) {
          console.error('[Stack]', error.stack)
        }
      }
    }

    process.on('uncaughtException', errorHandler)
    process.on('unhandledRejection', rejectionHandler)

    try {
      console.log('[Execute] 在沙箱中执行脚本...')

      // 在沙箱中执行脚本（同步部分；timeout 仅防同步死循环）
      env.runScript(scriptContent, 'custom-source-script.js')

      console.log('[Execute] 脚本代码执行完成，等待初始化...')

      // 等待初始化完成（给异步操作更多时间）
      const maxWaitTime = 5000 // 最多等待5秒
      const checkInterval = 100 // 每100ms检查一次
      let waited = 0

      while (!this.isInitialized && waited < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval))
        waited += checkInterval
      }

      if (!this.isInitialized) {
        console.error('[Timeout] 等待初始化超时')
        if (errorDetails.length > 0) {
          console.error('[Error Details]', JSON.stringify(errorDetails, null, 2))
        }
        throw initError || new Error('脚本未调用初始化事件（超时）')
      }

      console.log('[Success] 脚本加载成功\n')
      return this.sourceInfo
    } catch (error) {
      console.error('[Error] 脚本执行失败:', error.message)
      if (error.stack) {
        console.error('[Stack]', error.stack)
      }
      throw error
    } finally {
      process.removeListener('uncaughtException', errorHandler)
      process.removeListener('unhandledRejection', rejectionHandler)
    }
  }

  /**
   * 调用音源 API
   * @param {string} source - 音源 (kw, kg, tx, wy, mg, local)
   * @param {string} action - 操作 (musicUrl, lyric, pic)
   * @param {object} info - 请求信息（宿主对象，转沙箱后传给脚本）
   * @returns {Promise}
   */
  async callAPI(source, action, info) {
    if (!this.isInitialized) {
      throw new Error('脚本尚未初始化')
    }

    if (!this.events.request) {
      throw new Error('脚本未注册 request 事件处理器')
    }

    // 检查源是否支持
    if (!this.sourceInfo.sources[source]) {
      throw new Error(`不支持的音源: ${source}`)
    }

    // 检查操作是否支持
    const sourceConfig = this.sourceInfo.sources[source]
    if (!sourceConfig.actions.includes(action)) {
      throw new Error(`音源 ${source} 不支持操作: ${action}`)
    }

    console.log(`[API Call] ${source}.${action}`)
    console.log('[Info]', JSON.stringify(info))

    try {
      // 入参在沙箱域组装；脚本返回值转回宿主纯数据
      const payload = this.sandbox.newObject()
      payload.source = source
      payload.action = action
      payload.info = this.sandbox.toData(info)

      const result = await this.events.request(payload)
      const hostResult = this.sandbox.toHostValue(result)

      console.log('[Result]', JSON.stringify(hostResult, null, 2))
      return hostResult
    } catch (error) {
      console.error('[API Error]', error.message)
      throw error
    }
  }

  /**
   * 获取音乐 URL
   * @param {string} source - 音源
   * @param {object} musicInfo - 歌曲信息
   * @param {string} quality - 音质
   * @returns {Promise<string>}
   */
  async getMusicUrl(source, musicInfo, quality = '320k') {
    const result = await this.callAPI(source, 'musicUrl', {
      type: quality,
      musicInfo,
    })
    return result
  }

  /**
   * 获取歌词
   * @param {string} source - 音源
   * @param {object} musicInfo - 歌曲信息
   * @returns {Promise<object>}
   */
  async getLyric(source, musicInfo) {
    const result = await this.callAPI(source, 'lyric', {
      musicInfo,
    })
    return result
  }

  /**
   * 获取封面图片
   * @param {string} source - 音源
   * @param {object} musicInfo - 歌曲信息
   * @returns {Promise<string>}
   */
  async getPic(source, musicInfo) {
    const result = await this.callAPI(source, 'pic', {
      musicInfo,
    })
    return result
  }

  /**
   * 获取支持的音源列表
   * @returns {Array<string>}
   */
  getSupportedSources() {
    if (!this.isInitialized) {
      return []
    }
    return Object.keys(this.sourceInfo.sources)
  }

  /**
   * 获取音源支持的操作
   * @param {string} source - 音源
   * @returns {Array<string>}
   */
  getSupportedActions(source) {
    if (!this.isInitialized || !this.sourceInfo.sources[source]) {
      return []
    }
    return this.sourceInfo.sources[source].actions
  }

  /**
   * 获取音源支持的音质
   * @param {string} source - 音源
   * @returns {Array<string>}
   */
  getSupportedQualitys(source) {
    if (!this.isInitialized || !this.sourceInfo.sources[source]) {
      return []
    }
    return this.sourceInfo.sources[source].qualitys
  }
}

module.exports = LXEnvironmentSimulator
