/**
 * @name 测试音乐源
 * @description 这是一个用于测试的自定义音乐源
 * @version 1.0.0
 * @author Test Author
 * @homepage https://example.com
 */

// 获取 lx 对象
const { EVENT_NAMES, request, on, send } = globalThis.lx

console.log('[Script] 开始执行自定义源脚本...')

// 定义音质映射
const qualitys = {
  kw: {
    '128k': '128',
    '320k': '320',
    'flac': 'flac',
    'flac24bit': 'flac24bit',
  },
  kg: {
    '128k': '128',
    '320k': '320',
    'flac': 'flac',
    'flac24bit': 'flac24bit',
  },
}

// HTTP 请求封装
const httpRequest = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    request(url, options, (err, resp, body) => {
      if (err) {
        reject(err)
      } else {
        resolve(body)
      }
    })
  })
}

// 定义各音源的 API
const apis = {
  kw: {
    // 获取音乐 URL
    async musicUrl(musicInfo, quality) {
      console.log(`[kw.musicUrl] 正在获取歌曲 URL: ${musicInfo.name} - ${quality}`)
      
      // 这里是示例，实际应该调用真实的 API
      // 由于没有真实的接口，这里返回一个示例 URL
      const mockUrl = `https://example.com/music/${musicInfo.songmid}.mp3?quality=${quality}`
      
      console.log(`[kw.musicUrl] 返回 URL: ${mockUrl}`)
      return mockUrl
    },

    // 获取歌词
    async lyric(musicInfo) {
      console.log(`[kw.lyric] 正在获取歌词: ${musicInfo.name}`)
      
      // 示例歌词
      const mockLyric = {
        lyric: '[00:00.00]这是一首测试歌曲\n[00:05.00]用于测试自定义源脚本\n[00:10.00]作者：测试',
        tlyric: '[00:00.00]This is a test song\n[00:05.00]For testing custom source script\n[00:10.00]Author: Test',
        rlyric: null,
        lxlyric: null,
      }
      
      console.log(`[kw.lyric] 返回歌词`)
      return mockLyric
    },

    // 获取封面图片
    async pic(musicInfo) {
      console.log(`[kw.pic] 正在获取封面: ${musicInfo.name}`)
      
      const mockPicUrl = `https://example.com/pic/${musicInfo.songmid}.jpg`
      
      console.log(`[kw.pic] 返回封面 URL: ${mockPicUrl}`)
      return mockPicUrl
    },
  },

  kg: {
    // 获取音乐 URL
    async musicUrl(musicInfo, quality) {
      console.log(`[kg.musicUrl] 正在获取歌曲 URL: ${musicInfo.name} - ${quality}`)
      
      const mockUrl = `https://example.com/kg/music/${musicInfo.songmid}.mp3?quality=${quality}`
      
      console.log(`[kg.musicUrl] 返回 URL: ${mockUrl}`)
      return mockUrl
    },
  },

  local: {
    // 本地音乐 URL 获取
    async musicUrl(musicInfo) {
      console.log(`[local.musicUrl] 本地文件: ${musicInfo.filePath}`)
      return `file://${musicInfo.filePath}`
    },

    // 本地音乐歌词
    async lyric(musicInfo) {
      console.log(`[local.lyric] 本地歌词: ${musicInfo.filePath}`)
      // 这里应该读取本地歌词文件或从文件内嵌歌词中提取
      return {
        lyric: '[00:00.00]本地音乐\n[00:05.00]暂无歌词',
        tlyric: null,
        rlyric: null,
        lxlyric: null,
      }
    },

    // 本地音乐封面
    async pic(musicInfo) {
      console.log(`[local.pic] 本地封面: ${musicInfo.filePath}`)
      // 这里应该从音乐文件中提取封面
      return 'https://example.com/default-cover.jpg'
    },
  },
}

// 注册请求事件处理器
on(EVENT_NAMES.request, async ({ source, action, info }) => {
  console.log(`[Request] source=${source}, action=${action}`)

  // 检查音源是否存在
  if (!apis[source]) {
    throw new Error(`不支持的音源: ${source}`)
  }

  // 检查操作是否存在
  if (!apis[source][action]) {
    throw new Error(`音源 ${source} 不支持操作: ${action}`)
  }

  // 根据不同的 action 调用相应的 API
  switch (action) {
    case 'musicUrl':
      if (source === 'local') {
        return apis[source].musicUrl(info.musicInfo)
      } else {
        const quality = qualitys[source][info.type]
        return apis[source].musicUrl(info.musicInfo, quality)
      }

    case 'lyric':
      return apis[source].lyric(info.musicInfo)

    case 'pic':
      return apis[source].pic(info.musicInfo)

    default:
      throw new Error(`未知的操作: ${action}`)
  }
}).then(() => {
  console.log('[Script] request 事件处理器注册成功')
}).catch(err => {
  console.error('[Script] request 事件处理器注册失败:', err)
})

// 发送初始化完成事件
send(EVENT_NAMES.inited, {
  sources: {
    kw: {
      name: '酷我音乐',
      type: 'music',
      actions: ['musicUrl', 'lyric', 'pic'],
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
    },
    kg: {
      name: '酷狗音乐',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
    },
    local: {
      name: '本地音乐',
      type: 'music',
      actions: ['musicUrl', 'lyric', 'pic'],
      qualitys: [],
    },
  },
}).then(() => {
  console.log('[Script] 初始化事件发送成功')
}).catch(err => {
  console.error('[Script] 初始化事件发送失败:', err)
})

console.log('[Script] 自定义源脚本执行完成')
