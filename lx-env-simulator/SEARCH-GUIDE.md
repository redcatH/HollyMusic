# 音乐搜索功能使用指南

## 📋 概述

已为 `test-flower.js` 添加了搜索功能，支持从各大音乐平台搜索歌曲并获取真实的 MusicInfo 数据。

---

## 🎯 功能特点

### 1. 真实搜索
- 从各大音乐平台实时搜索歌曲
- 返回完整的 MusicInfo 对象（包含真实的 songmid、hash 等）
- 自动提取音质、专辑、歌手等信息

### 2. 无缝集成
- 搜索结果可直接传递给 `getMusicUrl()`
- 不需要手动构造测试数据
- 完全模拟真实使用场景

### 3. 支持的音源
- ✅ 酷我音乐 (kw)
- ✅ 酷狗音乐 (kg)  
- ✅ QQ音乐 (tx)
- ✅ 网易云音乐 (wy)
- ✅ 咪咕音乐 (mg)

---

## 🚀 快速开始

### 方法1: 使用完整测试脚本

```bash
# 测试搜索功能（包含搜索和播放链接获取）
node lx-env-simulator\test-flower.js
```

### 方法2: 单独测试搜索

```bash
# 只测试搜索功能
node lx-env-simulator\test-search.js
```

---

## 💻 代码示例

### 示例1: 基本搜索

```javascript
const musicSearch = require('./lx-env-simulator/music-search')

// 搜索歌曲
const result = await musicSearch.search('kw', '起风了', 1, 10)

console.log(result)
/*
{
  list: [
    {
      name: "起风了",
      singer: "买辣椒也用券",
      source: "kw",
      songmid: "243699",        // ← 真实的酷我音乐ID
      albumName: "起风了",
      interval: "05:20",
      types: [
        { type: "128k", size: "4.1M" },
        { type: "320k", size: "10.3M" },
        { type: "flac", size: "27.5M" }
      ],
      _types: { ... }
    },
    // ... 更多歌曲
  ],
  total: 1234,    // 总数
  page: 1,        // 当前页
  allPage: 124,   // 总页数
  limit: 10,      // 每页数量
  source: "kw"    // 音源
}
*/
```

### 示例2: 搜索 + 获取播放链接

```javascript
const LXEnvironmentSimulator = require('./lx-env-simulator')
const musicSearch = require('./lx-env-simulator/music-search')

// 1. 创建模拟器
const simulator = new LXEnvironmentSimulator()

// 2. 加载自定义源脚本
await simulator.loadScript('./flower-v1-offline.js')

// 3. 搜索歌曲
const searchResult = await musicSearch.search('kw', '起风了', 1, 10)
const firstMusic = searchResult.list[0]

console.log('找到歌曲:', firstMusic.name, '-', firstMusic.singer)
console.log('歌曲ID:', firstMusic.songmid)

// 4. 获取播放链接（直接使用搜索结果）
const url = await simulator.getMusicUrl('kw', firstMusic, '128k')

console.log('播放链接:', url)
```

### 示例3: 搜索多个音源

```javascript
const sources = ['kw', 'kg', 'tx', 'wy', 'mg']
const keyword = '起风了'

for (const source of sources) {
  try {
    const result = await musicSearch.search(source, keyword, 1, 5)
    
    console.log(`\n${source} 搜索结果:`)
    result.list.forEach((music, index) => {
      console.log(`${index + 1}. ${music.name} - ${music.singer}`)
      console.log(`   ID: ${music.songmid}`)
    })
  } catch (error) {
    console.error(`${source} 搜索失败:`, error.message)
  }
}
```

---

## 📖 API 文档

### musicSearch.search()

搜索歌曲

**参数:**
- `source` (string): 音源标识 (kw/kg/tx/wy/mg)
- `keyword` (string): 搜索关键词
- `page` (number): 页码，默认 1
- `limit` (number): 每页数量，默认 30

**返回:**
```typescript
{
  list: MusicInfo[],   // 歌曲列表
  total: number,       // 总数
  page: number,        // 当前页
  allPage: number,     // 总页数
  limit: number,       // 每页数量
  source: string       // 音源
}
```

**MusicInfo 结构:**
```typescript
{
  name: string,          // 歌曲名
  singer: string,        // 歌手
  source: string,        // 音源 (kw/kg/tx/wy/mg)
  songmid: string,       // 歌曲ID（主键）
  albumName: string,     // 专辑名
  albumId: string,       // 专辑ID
  interval: string,      // 时长，格式: "05:20"
  img: string | null,    // 封面图片URL
  types: Array<{         // 可用音质
    type: string,        // 音质类型: 128k/320k/flac/flac24bit
    size: string         // 文件大小: "4.1M"
  }>,
  _types: object,        // 音质快速查找对象
  typeUrl: object,       // 预留字段
  
  // 音源特定字段
  hash?: string,         // 酷狗音乐: 歌曲hash
  strMediaMid?: string,  // QQ音乐: Media ID
  songId?: number,       // QQ音乐: 数字ID
  albumMid?: string,     // QQ音乐: 专辑Mid
  copyrightId?: string,  // 咪咕音乐: 版权ID
}
```

---

## ⚠️ 注意事项

### 1. 网络访问限制

音乐平台通常有反爬虫机制：
- **需要代理**: 部分平台可能屏蔽特定IP
- **需要Headers**: 某些API需要特定的User-Agent或Referer
- **频率限制**: 连续请求可能被暂时屏蔽

**解决方案:**
```javascript
// 在搜索模块中已经设置了基本的 User-Agent
// 如果需要代理，可以配置 needle 使用代理
const needle = require('needle')
needle.defaults({
  proxy: 'http://127.0.0.1:7890'  // 设置代理
})
```

### 2. API 可能失效

音乐平台会不定期更改API：
- 如果搜索失败，可能是API地址变更
- 可以参考 LX Music Desktop 项目的最新代码
- 位置: `src/renderer/utils/musicSdk/{source}/musicSearch.js`

### 3. 加密算法

某些平台需要特殊加密：
- **网易云音乐**: 需要 eapi 加密（当前使用简化版）
- **QQ音乐**: 某些接口需要签名
- **咪咕音乐**: 需要特定的签名算法

---

## 🔧 高级用法

### 自定义搜索配置

修改 `music-search.js` 中的搜索参数：

```javascript
// 设置代理
const response = await needle('get', url, {
  proxy: 'http://127.0.0.1:7890',
  headers: {
    'User-Agent': '自定义UA',
    'Referer': '自定义Referer'
  }
})

// 设置超时
const response = await needle('get', url, {
  timeout: 10000  // 10秒超时
})
```

### 添加新的音源

```javascript
// 在 music-search.js 中添加
const newSourceSearch = {
  async search(keyword, page = 1, limit = 30) {
    // 实现搜索逻辑
    const url = `https://api.example.com/search?q=${keyword}`
    const response = await needle('get', url)
    
    // 解析返回数据
    const list = response.body.data.map(item => ({
      name: item.title,
      singer: item.artist,
      source: 'newsource',
      songmid: item.id,
      // ... 其他字段
    }))
    
    return { list, total, page, allPage, limit, source: 'newsource' }
  }
}

// 导出时添加
module.exports = {
  // ... 其他音源
  newsource: newSourceSearch,
}
```

### 批量搜索

```javascript
async function batchSearch(keyword) {
  const sources = ['kw', 'kg', 'tx', 'wy', 'mg']
  
  // 并行搜索所有音源
  const results = await Promise.allSettled(
    sources.map(source => musicSearch.search(source, keyword, 1, 10))
  )
  
  // 合并结果
  const allMusic = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allMusic.push(...result.value.list)
    } else {
      console.error(`${sources[index]} 搜索失败:`, result.reason)
    }
  })
  
  return allMusic
}
```

---

## 🎯 实际应用场景

### 场景1: 自动化测试

```javascript
// 自动测试多首歌曲
const testSongs = ['起风了', '青花瓷', '七里香', '稻香']

for (const song of testSongs) {
  const result = await musicSearch.search('kw', song, 1, 1)
  if (result.list.length > 0) {
    const music = result.list[0]
    const url = await simulator.getMusicUrl('kw', music, '128k')
    console.log(`${song}: ${url ? '✅' : '❌'}`)
  }
}
```

### 场景2: 歌单批量下载

```javascript
// 搜索并收集播放链接
async function collectPlaylist(songs) {
  const playlist = []
  
  for (const songName of songs) {
    const result = await musicSearch.search('kw', songName, 1, 1)
    if (result.list.length > 0) {
      const music = result.list[0]
      const url = await simulator.getMusicUrl('kw', music, '320k')
      playlist.push({ music, url })
    }
    await sleep(1000)  // 避免请求过快
  }
  
  return playlist
}
```

### 场景3: 多平台比价

```javascript
// 比较不同平台的音质
async function compareQuality(keyword) {
  const sources = ['kw', 'kg', 'tx']
  
  for (const source of sources) {
    const result = await musicSearch.search(source, keyword, 1, 1)
    if (result.list.length > 0) {
      const music = result.list[0]
      console.log(`\n${source}:`)
      console.log('  音质:', music.types.map(t => t.type).join(', '))
      console.log('  大小:', music.types.map(t => t.size).join(', '))
    }
  }
}
```

---

## 📚 相关文档

- [MUSICINFO-SOURCE.md](./MUSICINFO-SOURCE.md) - MusicInfo 的来源详解
- [BREAKPOINT-GUIDE.md](./BREAKPOINT-GUIDE.md) - 断点调试指南
- [DEBUG-GUIDE.md](./DEBUG-GUIDE.md) - 调试方法总览

---

## 🎉 完整工作流程

```
1. 搜索歌曲
   ↓
   musicSearch.search('kw', '起风了')
   
2. 获取 MusicInfo
   ↓
   result.list[0]
   {
     songmid: "243699",
     name: "起风了",
     singer: "买辣椒也用券",
     ...
   }
   
3. 加载自定义源
   ↓
   simulator.loadScript('flower-v1-offline.js')
   
4. 获取播放链接
   ↓
   simulator.getMusicUrl('kw', musicInfo, '128k')
   
5. 得到真实的播放URL
   ↓
   http://...
```

现在你可以：
- ✅ 实时搜索真实歌曲
- ✅ 获取完整的 MusicInfo
- ✅ 直接测试自定义源
- ✅ 无需手动构造测试数据

完全模拟了 LX Music Desktop 的真实使用场景！🎵
