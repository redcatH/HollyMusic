# LX Music 自定义源环境模拟器

完全模拟 LX Music 的运行环境，可以直接运行 LX Music 的自定义源脚本。

## 功能特性

- ✅ 完整的 `globalThis.lx` API 实现
- ✅ 支持所有自定义源事件 (request, inited, updateAlert)
- ✅ 支持所有工具函数 (crypto, buffer, zlib)
- ✅ 支持 HTTP 请求（不受跨域限制）
- ✅ 支持代理设置
- ✅ 完整的错误处理和日志输出
- ✅ 兼容 LX Music 自定义源脚本格式

## 安装依赖

```bash
npm install
```

## 快速开始

### 1. 基本使用

```javascript
const LXEnvironmentSimulator = require('./index')

async function main() {
  // 创建模拟器实例
  const simulator = new LXEnvironmentSimulator()

  // 加载自定义源脚本
  await simulator.loadScript('./your-custom-source.js')

  // 获取音乐 URL
  const url = await simulator.getMusicUrl('kw', {
    songmid: 'xxx',
    name: '歌曲名',
    singer: '歌手名',
  }, '320k')

  console.log('音乐 URL:', url)
}

main()
```

### 2. 运行测试示例

```bash
npm test
# 或
npm start
```

这会运行 `example.js`，使用 `test-source.js` 作为测试脚本。

## API 文档

### 创建实例

```javascript
const simulator = new LXEnvironmentSimulator()
```

### 设置代理（可选）

```javascript
simulator.setProxy('127.0.0.1', '7890')
```

### 加载脚本

```javascript
// 从文件加载
await simulator.loadScript('./path/to/script.js')

// 或直接执行脚本内容
await simulator.executeScript(scriptContent)
```

### 获取音乐 URL

```javascript
const url = await simulator.getMusicUrl(source, musicInfo, quality)

// 参数：
// - source: 音源 (kw, kg, tx, wy, mg, local)
// - musicInfo: 歌曲信息对象 { songmid, name, singer, ... }
// - quality: 音质 (128k, 320k, flac, flac24bit)
```

### 获取歌词

```javascript
const lyric = await simulator.getLyric(source, musicInfo)

// 返回值：
// {
//   lyric: '原始歌词',
//   tlyric: '翻译歌词',
//   rlyric: '罗马音歌词',
//   lxlyric: '逐字歌词'
// }
```

### 获取封面

```javascript
const picUrl = await simulator.getPic(source, musicInfo)
```

### 查询支持的音源

```javascript
const sources = simulator.getSupportedSources()
// 返回: ['kw', 'kg', 'tx', ...]
```

### 查询音源支持的操作

```javascript
const actions = simulator.getSupportedActions('kw')
// 返回: ['musicUrl', 'lyric', 'pic']
```

### 查询音源支持的音质

```javascript
const qualitys = simulator.getSupportedQualitys('kw')
// 返回: ['128k', '320k', 'flac', 'flac24bit']
```

### 直接调用 API

```javascript
const result = await simulator.callAPI(source, action, info)

// 示例：
const result = await simulator.callAPI('kw', 'musicUrl', {
  type: '320k',
  musicInfo: { songmid: 'xxx', name: '歌曲名' }
})
```

## 自定义源脚本格式

自定义源脚本必须遵循以下格式：

```javascript
/**
 * @name 音源名称
 * @description 音源描述
 * @version 1.0.0
 * @author 作者名
 * @homepage https://example.com
 */

const { EVENT_NAMES, request, on, send } = globalThis.lx

// 注册请求处理器
on(EVENT_NAMES.request, async ({ source, action, info }) => {
  // 处理不同的 action
  switch (action) {
    case 'musicUrl':
      return 'https://example.com/music.mp3'
    case 'lyric':
      return { lyric: '[00:00]歌词内容' }
    case 'pic':
      return 'https://example.com/pic.jpg'
  }
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
  },
})
```

## 完整示例

参考 `example.js` 和 `test-source.js` 文件。

## globalThis.lx API 说明

### 事件名称

```javascript
globalThis.lx.EVENT_NAMES = {
  request: 'request',      // API 请求事件
  inited: 'inited',        // 初始化完成事件
  updateAlert: 'updateAlert' // 更新提示事件
}
```

### HTTP 请求

```javascript
const cancel = globalThis.lx.request(url, options, callback)

// options:
// - method: 'get' | 'post' | 'put' | 'delete'
// - timeout: 超时时间（毫秒）
// - headers: 请求头对象
// - body: JSON 数据
// - form: 表单数据
// - formData: FormData 数据

// callback(err, resp, body)
```

### 事件注册

```javascript
await globalThis.lx.on(eventName, handler)
```

### 事件发送

```javascript
await globalThis.lx.send(eventName, data)
```

### 工具函数

#### 加密

```javascript
// AES 加密
const encrypted = globalThis.lx.utils.crypto.aesEncrypt(buffer, mode, key, iv)

// RSA 加密
const encrypted = globalThis.lx.utils.crypto.rsaEncrypt(buffer, publicKey)

// MD5
const hash = globalThis.lx.utils.crypto.md5('string')

// 随机字节
const bytes = globalThis.lx.utils.crypto.randomBytes(16)
```

#### Buffer

```javascript
// 创建 Buffer
const buf = globalThis.lx.utils.buffer.from('string', 'base64')

// Buffer 转字符串
const str = globalThis.lx.utils.buffer.bufToString(buf, 'utf8')
```

#### 压缩

```javascript
// 压缩
const compressed = await globalThis.lx.utils.zlib.deflate(data)

// 解压
const decompressed = await globalThis.lx.utils.zlib.inflate(compressed)
```

## 日志输出

模拟器会输出详细的日志信息：

- `[Load]` - 脚本加载
- `[Script Info]` - 脚本信息
- `[Init]` - 初始化
- `[Event]` - 事件注册
- `[HTTP]` - HTTP 请求
- `[API Call]` - API 调用
- `[Result]` - 返回结果
- `[Error]` - 错误信息

## 注意事项

1. **脚本格式**：脚本必须包含正确的头部注释
2. **初始化**：脚本必须调用 `send(EVENT_NAMES.inited, ...)` 完成初始化
3. **请求处理器**：必须注册 `request` 事件处理器
4. **异步操作**：所有 API 调用都是异步的，需要使用 `await`
5. **错误处理**：建议在调用时使用 try-catch 捕获错误

## 与 LX Music 的兼容性

此模拟器完全兼容 LX Music Desktop 的自定义源脚本（API 版本 2.0.0）。

你可以：
- 直接使用为 LX Music 编写的自定义源脚本
- 在开发自定义源时使用此模拟器进行测试
- 将自定义源集成到自己的项目中

## 许可证

MIT
