/**
 * LX Music 自定义源环境模拟器
 * 可以直接运行 LX Music 的自定义源脚本
 */

const needle = require('needle')
const { createCipheriv, publicEncrypt, constants, randomBytes: _randomBytes, createHash } = require('crypto')
const { inflate: _inflate, deflate: _deflate } = require('zlib')
const { existsSync, readFileSync } = require('fs')

class LXEnvironmentSimulator {
  constructor() {
    this.events = {}
    this.isInitialized = false
    this.sourceInfo = null
    this.proxy = {
      host: '',
      port: '',
    }
    this.initGlobalLX()
  }

  /**
   * 初始化 globalThis.lx 对象
   */
  initGlobalLX() {
    const self = this

    globalThis.lx = {
      // 事件名称常量
      EVENT_NAMES: {
        request: 'request',
        inited: 'inited',
        updateAlert: 'updateAlert',
      },

      // API 版本
      version: '2.0.0',

      // 运行环境
      env: 'desktop',

      // 当前脚本信息
      currentScriptInfo: {
        name: '',
        description: '',
        version: '',
        author: '',
        homepage: '',
        rawScript: '',
      },

      /**
       * HTTP 请求方法
       * @param {string} url - 请求 URL
       * @param {object} options - 请求选项
       * @param {function} callback - 回调函数 (err, resp, body)
       * @returns {function} 取消请求的函数
       */
      request(url, options = {}, callback) {
        const {
          method = 'get',
          timeout = 5000,
          headers = {},
          body,
          form,
          formData,
        } = options
        const safeValue = (val) => {
          if (Buffer.isBuffer(val)) return `[Buffer ${val.length} bytes]`
          if (val && typeof val === 'object') {
            try {
              return JSON.parse(JSON.stringify(val))
            } catch (_) {
              return '[Object]'
            }
          }
          return val
        }

        const reqDetails = {
          method: method.toUpperCase(),
          url,
          timeout,
          headers,
          body: safeValue(body),
          form: safeValue(form),
          formData: safeValue(formData),
        }

        console.log('[HTTP] Request Params:', JSON.stringify(reqDetails, null, 2))
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

        console.log(`[HTTP] ${method.toUpperCase()} ${url}`)

        const request = needle.request(
          method,
          url,
          data,
          requestOptions,
          (err, resp) => {
            if (err) {
              console.error(`[HTTP Error] ${err.message}`)
              callback(err, null, null)
              return
            }

            let bodyData = resp.body
            if (typeof bodyData === 'string') {
              try {
                bodyData = JSON.parse(bodyData)
              } catch (_) {}
            }

            const response = {
              statusCode: resp.statusCode,
              statusMessage: resp.statusMessage,
              headers: resp.headers,
              body: bodyData,
              bytes: resp.bytes,
              raw: resp.raw,
            }

            callback(null, response, bodyData)
          }
        ).request

        // 返回取消函数
        return () => {
          if (request && !request.aborted) {
            request.abort()
          }
        }
      },

      /**
       * 注册事件监听器
       * @param {string} eventName - 事件名称
       * @param {function} handler - 事件处理函数
       * @returns {Promise}
       */
      on(eventName, handler) {
        return new Promise((resolve, reject) => {
          const validEvents = Object.values(globalThis.lx.EVENT_NAMES)
          if (!validEvents.includes(eventName)) {
            return reject(new Error(`不支持的事件: ${eventName}`))
          }

          if (eventName === 'request') {
            self.events.request = handler
            console.log('[Event] 已注册 request 事件处理器')
          }

          resolve()
        })
      },

      /**
       * 发送事件
       * @param {string} eventName - 事件名称
       * @param {*} data - 事件数据
       * @returns {Promise}
       */
      send(eventName, data) {
        return new Promise((resolve, reject) => {
          const validEvents = Object.values(globalThis.lx.EVENT_NAMES)
          if (!validEvents.includes(eventName)) {
            return reject(new Error(`不支持的事件: ${eventName}`))
          }

          switch (eventName) {
            case 'inited':
              if (self.isInitialized) {
                return reject(new Error('脚本已经初始化'))
              }
              self.isInitialized = true
              self.sourceInfo = data
              console.log('[Init] 自定义源初始化成功:', JSON.stringify(data, null, 2))
              resolve()
              break

            case 'updateAlert':
              console.log('[Update Alert]', data.log)
              if (data.updateUrl) {
                console.log('[Update URL]', data.updateUrl)
              }
              resolve()
              break

            default:
              reject(new Error(`未知事件: ${eventName}`))
          }
        })
      },

      // 工具函数集合
      utils: {
        // 加密相关
        crypto: {
          /**
           * AES 加密
           * @param {Buffer} buffer - 要加密的数据
           * @param {string} mode - 加密模式 (aes-128-cbc, aes-128-ecb)
           * @param {Buffer} key - 密钥
           * @param {Buffer} iv - 初始化向量
           * @returns {Buffer}
           */
          aesEncrypt(buffer, mode, key, iv) {
            const cipher = createCipheriv(mode, key, iv)
            return Buffer.concat([cipher.update(buffer), cipher.final()])
          },

          /**
           * RSA 加密
           * @param {Buffer} buffer - 要加密的数据
           * @param {string} key - 公钥
           * @returns {Buffer}
           */
          rsaEncrypt(buffer, key) {
            buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
            return publicEncrypt(
              {
                key,
                padding: constants.RSA_NO_PADDING,
              },
              buffer
            )
          },

          /**
           * 生成随机字节
           * @param {number} size - 字节数
           * @returns {Buffer}
           */
          randomBytes(size) {
            return _randomBytes(size)
          },

          /**
           * MD5 哈希
           * @param {string} str - 要哈希的字符串
           * @returns {string}
           */
          md5(str) {
            return createHash('md5').update(str).digest('hex')
          },
        },

        // Buffer 操作
        buffer: {
          /**
           * 创建 Buffer
           * @param {...*} args - Buffer.from 的参数
           * @returns {Buffer}
           */
          from(...args) {
            return Buffer.from(...args)
          },

          /**
           * Buffer 转字符串
           * @param {Buffer} buf - Buffer 对象
           * @param {string} format - 编码格式
           * @returns {string}
           */
          bufToString(buf, format) {
            return Buffer.from(buf, 'binary').toString(format)
          },
        },

        // 压缩相关
        zlib: {
          /**
           * 解压缩
           * @param {Buffer} buf - 压缩的数据
           * @returns {Promise<Buffer>}
           */
          inflate(buf) {
            return new Promise((resolve, reject) => {
              _inflate(buf, (err, data) => {
                if (err) reject(new Error(err.message))
                else resolve(data)
              })
            })
          },

          /**
           * 压缩
           * @param {Buffer} data - 要压缩的数据
           * @returns {Promise<Buffer>}
           */
          deflate(data) {
            return new Promise((resolve, reject) => {
              _deflate(data, (err, buf) => {
                if (err) reject(new Error(err.message))
                else resolve(buf)
              })
            })
          },
        },
      },
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
   * 执行自定义源脚本
   * @param {string} scriptContent - 脚本内容
   * @returns {Promise}
   */
  async executeScript(scriptContent) {
    // 解析脚本信息
    const scriptInfo = this.parseScriptInfo(scriptContent)
    console.log('[Script Info]', scriptInfo)

    // 设置当前脚本信息
    globalThis.lx.currentScriptInfo = {
      ...scriptInfo,
      rawScript: scriptContent,
    }
    console.log('[Script Info]', JSON.stringify(globalThis.lx.currentScriptInfo, null, 2))

    // 验证 globalThis.lx 是否正确初始化
    if (!globalThis.lx || !globalThis.lx.EVENT_NAMES) {
      throw new Error('globalThis.lx 未正确初始化')
    }

    console.log('[Debug] globalThis.lx 已准备就绪')
    console.log('[Debug] EVENT_NAMES:', globalThis.lx.EVENT_NAMES)
    console.log('[Debug] env:', globalThis.lx.env)
    console.log('[Debug] version:', globalThis.lx.version)

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
      console.log('[Execute] 开始执行脚本...')
      
      // 执行脚本
      // 添加 sourceURL 使脚本在调试器中可见并可断点
      // 使用实际的脚本名称，这样在调试器中更容易识别
      const scriptName = 'custom-source-script'
      const sourceURL = `${scriptName}.js`
      
      console.log(`[Debug] 脚本将以 "${sourceURL}" 的名称出现在调试器中`)
      console.log('[Debug] 你可以在调试器的源代码列表中找到它并设置断点')
      
      // debugger; // 取消注释这行可以在脚本执行前自动暂停
      eval(scriptContent + `\n//# sourceURL=${sourceURL}`)

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
   * @param {object} info - 请求信息
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

    console.log(`\n[API Call] ${source}.${action}`)
    console.log('[Info]', JSON.stringify(info, null, 2))

    try {
      const result = await this.events.request({
        source,
        action,
        info,
      })

      console.log('[Result]', JSON.stringify(result, null, 2))
      return result
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
