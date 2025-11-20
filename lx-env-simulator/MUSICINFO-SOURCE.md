# MusicInfo 的来源分析

## 📋 概述

在 LX Music Desktop 中，`MusicInfo` 对象是核心数据结构，包含了歌曲的所有信息。本文档详细说明 `MusicInfo` 的来源和生成过程。

---

## 🏗️ MusicInfo 数据结构

### TypeScript 定义

位置：`src/common/types/music.d.ts`

```typescript
interface MusicInfo {
  id: string                    // 歌曲唯一标识，格式: source_songId
  name: string                  // 歌曲名
  singer: string                // 艺术家名
  source: 'kw'|'kg'|'tx'|'wy'|'mg'|'local'  // 音源
  interval: string | null       // 时长，格式: "03:55"
  meta: MusicInfoMeta          // 元数据
}

// 在线音源的元数据
interface MusicInfoMeta_online {
  songId: string | number       // 歌曲ID（各平台的原始ID）
  albumName: string             // 专辑名
  picUrl?: string | null        // 图片链接
  qualitys: MusicQualityType[]  // 可用音质列表
  _qualitys: _MusicQualityType  // 音质对象（快速查找）
  albumId?: string | number     // 专辑ID
}
```

### 不同音源的特殊字段

#### 酷我音乐 (kw)
```typescript
{
  id: "kw_243699",
  name: "起风了",
  singer: "买辣椒也用券",
  source: "kw",
  interval: "05:20",
  meta: {
    songId: "243699",           // ← 酷我的歌曲ID
    albumName: "起风了",
    picUrl: "http://...",
    qualitys: [{type: "128k", size: "3.2M"}, ...],
    _qualitys: {
      "128k": {size: "3.2M"},
      "320k": {size: "8.5M"},
      ...
    }
  }
}
```

#### 酷狗音乐 (kg)
```typescript
{
  id: "123456_ABCDEF...",       // ← songmid + "_" + hash
  meta: {
    hash: "ABCDEF1234567890",   // ← 酷狗特有的hash
    ...
  }
}
```

#### QQ音乐 (tx)
```typescript
{
  meta: {
    songId: "243699",
    strMediaMid: "003OUlho2HcRHC",  // ← QQ音乐的Media ID
    id: 243699,                      // ← 数字ID
    albumMid: "...",
    ...
  }
}
```

#### 网易云音乐 (wy)
```typescript
{
  meta: {
    songId: "347230",           // ← 网易云的歌曲ID
    ...
  }
}
```

#### 咪咕音乐 (mg)
```typescript
{
  meta: {
    copyrightId: "60054701923",  // ← 咪咕使用copyrightId
    lrcUrl: "http://...",        // ← 歌词URL（咪咕提供）
    mrcUrl: "http://...",
    trcUrl: "http://...",
    ...
  }
}
```

---

## 🔍 MusicInfo 的来源

### 1. 搜索功能

#### 用户搜索流程
```
用户输入关键词
    ↓
[src/renderer/views/Search/] 搜索组件
    ↓
[src/renderer/store/search/music/action.ts] search()
    ↓
[src/renderer/utils/musicSdk/{source}/musicSearch.js] 各音源搜索API
    ↓
调用各平台的搜索接口
    ↓
返回搜索结果 (原始格式)
    ↓
[src/common/utils/tools.ts] toNewMusicInfo() 转换为新格式
    ↓
生成 MusicInfo 对象
```

#### 代码示例

**酷我音乐搜索**  
位置：`src/renderer/utils/musicSdk/kw/musicSearch.js`

```javascript
export default {
  async search(str, page, limit = 30) {
    // 1. 调用酷我搜索API
    const url = `http://search.kuwo.cn/r.s`
    const params = {
      all: str,
      ft: 'music',
      pn: page - 1,
      rn: limit,
      ...
    }
    
    const response = await httpFetch(url, params)
    
    // 2. 解析返回数据
    const musicList = response.body.abslist.map(item => ({
      singer: formatSinger(item.ARTIST),
      name: item.SONGNAME,
      albumName: item.ALBUM,
      songmid: item.MUSICRID.replace('MUSIC_', ''),  // ← 歌曲ID
      img: item.pic,
      source: 'kw',
      interval: formatPlayTime(item.DURATION),
      // ... 音质信息
    }))
    
    return {
      list: musicList,  // ← 返回原始格式（旧格式）
      allPage: ...,
      limit: ...,
    }
  }
}
```

**转换为新格式**  
位置：`src/renderer/store/search/music/action.ts`

```typescript
export const search = async(text: string, page: number, source: string) => {
  // 1. 调用音源SDK搜索
  const result = await music[source].musicSearch.search(text, page, limit)
  
  // 2. 转换为新格式
  const musicList = result.list.map(oldInfo => {
    return markRaw(toNewMusicInfo(oldInfo))  // ← 转换！
  })
  
  return musicList
}
```

**转换函数**  
位置：`src/common/utils/tools.ts`

```typescript
export const toNewMusicInfo = (oldMusicInfo: any): LX.Music.MusicInfo => {
  return {
    id: `${oldMusicInfo.source}_${oldMusicInfo.songmid}`,
    name: oldMusicInfo.name,
    singer: oldMusicInfo.singer,
    source: oldMusicInfo.source,
    interval: oldMusicInfo.interval,
    meta: {
      songId: oldMusicInfo.songmid,      // ← 关键！原始平台ID
      albumName: oldMusicInfo.albumName,
      picUrl: oldMusicInfo.img,
      qualitys: oldMusicInfo.types,
      _qualitys: oldMusicInfo._types,
      // ... 其他字段
    }
  }
}
```

---

### 2. 歌单导入

```
用户选择歌单
    ↓
[musicSdk/{source}/songList.js] 获取歌单详情
    ↓
解析歌单中的歌曲列表
    ↓
每首歌转换为 MusicInfo
```

---

### 3. 排行榜

```
用户打开排行榜
    ↓
[musicSdk/{source}/leaderboard.js] 获取榜单数据
    ↓
返回歌曲列表 (MusicInfo[])
```

---

### 4. 本地音乐扫描

位置：`src/renderer/utils/music.ts`

```typescript
export const createLocalMusicInfo = async(path: string): Promise<LX.Music.MusicInfoLocal> => {
  // 1. 读取文件元数据
  const { parseFile } = await import('music-metadata')
  const metadata = await parseFile(path)
  
  // 2. 创建本地音乐信息
  return {
    id: path,                                        // ← 本地文件用路径作为ID
    name: metadata.common.title || basename(path),
    singer: metadata.common.artists?.join('、') || '',
    source: 'local',
    interval: formatPlayTime(metadata.format.duration),
    meta: {
      albumName: metadata.common.album ?? '',
      filePath: path,                                // ← 本地特有
      songId: path,
      picUrl: '',
      ext: extname(path).replace(/^\./, ''),
    },
  }
}
```

---

### 5. 用户添加的自定义源

位置：`src/renderer/core/useApp/useInitUserApi.ts`

```typescript
// 自定义源的 search 方法返回的数据
apis[source].search = (keyword, page, limit) => {
  return new Promise((resolve, reject) => {
    // 自定义源返回的格式（用户脚本定义）
    const result = {
      list: [
        {
          name: "歌曲名",
          singer: "歌手",
          songmid: "平台ID",       // ← 自定义源自己定义的ID
          albumName: "专辑",
          source: "custom_source_name",
          // ...
        }
      ],
      allPage: 1,
      limit: 30,
      total: 30
    }
    
    // 也会通过 toNewMusicInfo 转换
    resolve(result)
  })
}
```

---

## 🎵 传递给自定义源的 MusicInfo

### 调用链路

```
用户播放歌曲
    ↓
[src/renderer/core/player/action.ts] play()
    ↓
[src/renderer/core/music/index.ts] getMusicUrl()
    ↓
[src/renderer/core/music/utils.ts] 判断音源类型
    ↓
如果是自定义源:
  [src/renderer/core/music/utils.ts] Line 272
  apis[source].getMusicUrl(toOldMusicInfo(musicInfo), quality)
                           ↑
                      转换为旧格式！
    ↓
触发自定义源的 request 事件
    ↓
globalThis.lx.on('request', ({ source, action, info }) => {
  // info.musicInfo 就是 toOldMusicInfo 转换后的对象
  const musicInfo = info.musicInfo
  console.log(musicInfo.songmid)  // ← 这里就是原始平台ID
})
```

### toOldMusicInfo 转换

位置：`src/common/utils/tools.ts`

```typescript
export const toOldMusicInfo = (minfo: LX.Music.MusicInfo) => {
  return {
    name: minfo.name,
    singer: minfo.singer,
    source: minfo.source,
    songmid: minfo.meta.songId,      // ← 从 meta.songId 提取
    interval: minfo.interval,
    albumName: minfo.meta.albumName,
    img: minfo.meta.picUrl ?? '',
    
    // 酷狗特有
    hash: minfo.meta.hash,
    
    // QQ音乐特有
    strMediaMid: minfo.meta.strMediaMid,
    albumMid: minfo.meta.albumMid,
    songId: minfo.meta.id,
    
    // 咪咕特有
    copyrightId: minfo.meta.copyrightId,
    lrcUrl: minfo.meta.lrcUrl,
    
    // 音质信息
    types: minfo.meta.qualitys,
    _types: minfo.meta._qualitys,
    typeUrl: {},
  }
}
```

---

## 🌟 实际例子

### 例子1：搜索 "起风了" (酷我音乐)

#### 1. 搜索请求
```javascript
// 用户输入: "起风了"
await music.kw.musicSearch.search("起风了", 1, 30)
```

#### 2. 酷我API返回（简化）
```json
{
  "abslist": [
    {
      "MUSICRID": "MUSIC_243699",
      "SONGNAME": "起风了",
      "ARTIST": "买辣椒也用券",
      "ALBUM": "起风了",
      "pic": "http://img.kuwo.cn/...",
      "DURATION": 320,
      "formats": "MP3128|MP3320|ALFLAC"
    }
  ]
}
```

#### 3. 转换为旧格式
```javascript
{
  name: "起风了",
  singer: "买辣椒也用券",
  albumName: "起风了",
  songmid: "243699",              // ← MUSICRID 去掉前缀
  img: "http://img.kuwo.cn/...",
  source: "kw",
  interval: "05:20",
  types: [
    {type: "128k", size: "4.1M"},
    {type: "320k", size: "10.3M"},
    {type: "flac", size: "27.5M"}
  ],
  _types: {
    "128k": {size: "4.1M"},
    "320k": {size: "10.3M"},
    "flac": {size: "27.5M"}
  }
}
```

#### 4. 转换为新格式 (MusicInfo)
```javascript
{
  id: "kw_243699",
  name: "起风了",
  singer: "买辣椒也用券",
  source: "kw",
  interval: "05:20",
  meta: {
    songId: "243699",             // ← 这就是平台原始ID
    albumName: "起风了",
    picUrl: "http://img.kuwo.cn/...",
    qualitys: [...],
    _qualitys: {...}
  }
}
```

#### 5. 传递给自定义源时
```javascript
// 当用户播放这首歌，自定义源收到的参数:
globalThis.lx.on('request', ({ source, action, info }) => {
  console.log(info.musicInfo)
  /*
  {
    name: "起风了",
    singer: "买辣椒也用券",
    source: "kw",
    songmid: "243699",      // ← 回到旧格式，songmid 是平台ID
    albumName: "起风了",
    img: "http://...",
    interval: "05:20",
    types: [...],
    _types: {...}
  }
  */
})
```

---

### 例子2：酷狗音乐

#### 搜索结果
```javascript
{
  // 旧格式
  songmid: "123456",
  hash: "ABCDEF1234567890",     // ← 酷狗特有
  name: "歌曲名",
  singer: "歌手",
  source: "kg",
  ...
}

// 转换为新格式后
{
  id: "123456_ABCDEF1234567890",  // ← songmid + "_" + hash
  meta: {
    songId: "123456",
    hash: "ABCDEF1234567890",     // ← meta 中保留 hash
    ...
  }
}

// 传递给自定义源时（toOldMusicInfo）
{
  songmid: "123456",              // ← 还原为原始格式
  hash: "ABCDEF1234567890",       // ← hash 也在顶层
  name: "歌曲名",
  ...
}
```

---

## 📝 总结

### MusicInfo 的生命周期

```
1. 数据来源 (搜索/歌单/榜单/本地)
    ↓
2. 各音源SDK返回原始数据 (旧格式)
    {
      songmid: "平台ID",    ← 关键！
      name: "...",
      singer: "...",
      source: "kw",
      ...
    }
    ↓
3. toNewMusicInfo() 转换为新格式
    {
      id: "source_songId",
      meta: {
        songId: "平台ID",   ← 存储在这里
        ...
      }
    }
    ↓
4. 前端使用 (播放/收藏/编辑)
    ↓
5. 调用自定义源时，toOldMusicInfo() 转回旧格式
    {
      songmid: "平台ID",   ← 恢复为这个
      ...
    }
    ↓
6. 自定义源使用 musicInfo.songmid
```

### 关键字段映射

| 字段名 | 新格式位置 | 旧格式位置 | 说明 |
|--------|-----------|-----------|------|
| 平台ID | `meta.songId` | `songmid` | 各平台的原始歌曲ID |
| 歌曲名 | `name` | `name` | 不变 |
| 歌手 | `singer` | `singer` | 不变 |
| 音源 | `source` | `source` | kw/kg/tx/wy/mg |
| 图片 | `meta.picUrl` | `img` | URL |
| 专辑 | `meta.albumName` | `albumName` | 不变 |
| 音质 | `meta.qualitys` | `types` | 数组 |
| 音质快查 | `meta._qualitys` | `_types` | 对象 |

### 特殊字段

| 音源 | 特殊字段 | 新格式 | 旧格式 |
|------|---------|-------|-------|
| kg | hash | `meta.hash` | `hash` |
| tx | strMediaMid | `meta.strMediaMid` | `strMediaMid` |
| mg | copyrightId | `meta.copyrightId` | `copyrightId` |

---

## 💡 在自定义源中使用

### 你收到的 musicInfo 格式

```javascript
globalThis.lx.on('request', ({ source, action, info }) => {
  const { musicInfo, type } = info
  
  // musicInfo 是旧格式，包含:
  console.log(musicInfo.songmid)     // ← 平台原始ID (必有)
  console.log(musicInfo.name)        // ← 歌曲名
  console.log(musicInfo.singer)      // ← 歌手
  console.log(musicInfo.source)      // ← 音源标识
  console.log(musicInfo.albumName)   // ← 专辑名
  
  // 根据不同音源，可能还有:
  if (source === 'kg') {
    console.log(musicInfo.hash)      // ← 酷狗的hash
  }
  if (source === 'tx') {
    console.log(musicInfo.strMediaMid) // ← QQ音乐的Media ID
  }
  if (source === 'mg') {
    console.log(musicInfo.copyrightId) // ← 咪咕的版权ID
  }
  
  // type 是请求的音质
  console.log(type)  // "128k" | "320k" | "flac" | ...
})
```

### 构造用于测试的 MusicInfo

```javascript
// 测试数据应该使用旧格式
const testMusicInfo = {
  name: "起风了",
  singer: "买辣椒也用券",
  source: "kw",
  songmid: "243699",        // ← 关键！平台ID
  albumName: "起风了",
  img: "http://...",
  interval: "05:20",
  types: [
    {type: "128k", size: "4.1M"},
    {type: "320k", size: "10.3M"}
  ],
  _types: {
    "128k": {size: "4.1M"},
    "320k": {size: "10.3M"}
  }
}

// 在模拟器中直接使用
await simulator.getMusicUrl('kw', testMusicInfo, '128k')
```

---

## 🎯 现在你明白了

1. **MusicInfo 来自各音源的搜索/歌单API**
2. **核心字段是 `songmid`（旧格式）或 `meta.songId`（新格式）**
3. **传递给自定义源时会转换为旧格式**
4. **所以你的测试数据完全正确！**

你在 `test-flower.js` 中构造的测试数据：
```javascript
{
  songmid: '243699',  // ← 这就是酷我音乐的歌曲ID
  name: '测试歌曲',
  singer: '测试歌手',
  ...
}
```

这和真实的 MusicInfo 完全一致！👍
