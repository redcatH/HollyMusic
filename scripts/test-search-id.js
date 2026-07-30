#!/usr/bin/env node
// scripts/test-search-id.js
// 测试不同音源搜索返回的 id 格式，分析跨源 songmid 碰撞情况
// 用法: node scripts/test-search-id.js [关键词] [每源数量]
//   默认: 关键词="周杰伦", 每源数量=20
//
// 说明:
//   music-search.js 是 ESM，无法直接 node 运行，故本脚本以 CJS 镜像 5 个源的搜索逻辑，
//   复用 lib/music-core 下的 CJS 模块 (request.js / wy-eapi.js)，真实发起请求。
//   目的: 保存各源返回格式，找出让 id 跨源不重复的办法。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { simpleFetch } = require(path.join(__dirname, '..', 'lib', 'music-core', 'request'))
const { eapi } = require(path.join(__dirname, '..', 'lib', 'music-core', 'wy-eapi'))

// ============================================================
// 工具函数（镜像 music-search.js / utils.js）
// ============================================================
function formatPlayTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00'
  const sec = Math.floor(seconds)
  const min = Math.floor(sec / 60)
  const hour = Math.floor(min / 60)
  if (hour > 0) return `${hour.toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`
  return `${min.toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`
}

function sizeFormate(bytes) {
  if (!bytes || bytes === 0) return '0B'
  const k = 1024
  const sizes = ['B', 'K', 'M', 'G', 'T']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + sizes[i]
}

function formatSingerName(singers, key = 'name') {
  if (!Array.isArray(singers)) return ''
  return singers.map(s => s[key] || s).filter(Boolean).join('、')
}

function decodeName(str) {
  if (!str) return ''
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
}

function toMD5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex')
}

function createMgSignature(time, keyword) {
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
  const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73'
  const sign = toMD5(`${keyword}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`)
  return { sign, deviceId }
}

// ============================================================
// 酷我 (kw)
// ============================================================
async function searchKw(keyword, limit) {
  const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=0&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`
  const result = await simpleFetch(url, {
    method: 'get',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  if (!result || result.TOTAL !== '0' && result.SHOW === '0') {
    throw new Error('kw: 需要重试 (TOTAL!=0 但 SHOW=0)')
  }
  const abslist = result.abslist || []
  return abslist.map(item => {
    const songId = item.MUSICRID.replace('MUSIC_', '')
    return {
      source: 'kw',
      songmid: songId,
      name: decodeName(item.SONGNAME),
      singer: decodeName(item.ARTIST),
      albumId: decodeName(item.ALBUMID || ''),
      albumName: item.ALBUM ? decodeName(item.ALBUM) : '',
      _raw: { MUSICRID: item.MUSICRID, SONGNAME: item.SONGNAME, ARTIST: item.ARTIST, ALBUMID: item.ALBUMID, DURATION: item.DURATION },
    }
  })
}

// ============================================================
// 酷狗 (kg)
// ============================================================
async function searchKg(keyword, limit) {
  const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`
  const result = await simpleFetch(url, {
    method: 'get',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  if (!result || result.error_code !== 0) throw new Error('kg: error_code != 0')
  const rawList = result.data.lists || []
  const list = []
  const ids = new Set()
  for (const item of rawList) {
    const key = item.Audioid + item.FileHash
    if (ids.has(key)) continue
    ids.add(key)
    list.push({
      source: 'kg',
      songmid: item.Audioid,
      hash: item.FileHash,
      name: decodeName(item.SongName),
      singer: item.Singers ? formatSingerName(item.Singers, 'name') : (item.SingerName || ''),
      albumId: item.AlbumID,
      albumName: decodeName(item.AlbumName),
      _raw: { Audioid: item.Audioid, FileHash: item.FileHash, SongName: item.SongName, AlbumID: item.AlbumID },
    })
    // 分组条目
    if (item.Grp && Array.isArray(item.Grp)) {
      for (const childItem of item.Grp) {
        const childKey = childItem.Audioid + childItem.FileHash
        if (ids.has(childKey)) continue
        ids.add(childKey)
        list.push({
          source: 'kg',
          songmid: childItem.Audioid,
          hash: childItem.FileHash,
          name: decodeName(childItem.SongName),
          singer: childItem.Singers ? formatSingerName(childItem.Singers, 'name') : (childItem.SingerName || ''),
          albumId: childItem.AlbumID,
          albumName: decodeName(childItem.AlbumName),
          _raw: { Audioid: childItem.Audioid, FileHash: childItem.FileHash, SongName: childItem.SongName, AlbumID: childItem.AlbumID },
        })
      }
    }
  }
  return list
}

// ============================================================
// QQ音乐 (tx)
// ============================================================
async function searchTx(keyword, limit) {
  const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
  const postData = {
    comm: { ct: 11, cv: '1003006', v: '1003006', os_ver: '12', phonetype: '0', devicelevel: '31', tmeAppID: 'qqmusiclight', nettype: 'NETWORK_WIFI' },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicLite',
      param: { query: keyword, search_type: 0, num_per_page: limit, page_num: 1, nqc_flag: 0, grp: 1 },
    },
  }
  const result = await simpleFetch(url, {
    method: 'post',
    body: postData,
    json: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)' },
  })
  if (!result || result.code !== 0 || result.req.code !== 0) throw new Error('tx: 搜索失败')
  const rawList = result.req.data.body.item_song || []
  return rawList.filter(item => item.file && item.file.media_mid).map(item => ({
    source: 'tx',
    songmid: item.mid,
    songId: item.id,
    strMediaMid: item.file.media_mid,
    name: item.name + (item.title_extra || ''),
    singer: formatSingerName(item.singer, 'name'),
    albumId: item.album ? item.album.mid : '',
    albumName: item.album ? (item.album.name || '') : '',
    _raw: { mid: item.mid, id: item.id, media_mid: item.file.media_mid, name: item.name, interval: item.interval },
  }))
}

// ============================================================
// 网易云 (wy)
// ============================================================
async function searchWy(keyword, limit) {
  const apiPath = '/api/cloudsearch/pc'
  const body = { s: keyword, type: 1, limit, total: true, offset: 0 }
  const formObj = eapi(apiPath, body)
  const formStr = new URLSearchParams(formObj).toString()
  const result = await simpleFetch('http://interface.music.163.com/eapi/batch', {
    method: 'post',
    body: formStr,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'https://music.163.com',
      'Referer': 'https://music.163.com/',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })
  if (!result || result.code !== 200) throw new Error('wy: code != 200')
  const rawList = (result.result && result.result.songs) || []
  return rawList.map(item => {
    const album = item.al || {}
    const singers = Array.isArray(item.ar) ? item.ar.map(s => s.name).filter(Boolean).join('、') : ''
    return {
      source: 'wy',
      songmid: String(item.id),
      name: item.name,
      singer: singers,
      albumId: album.id,
      albumName: album.name || '',
      _raw: { id: item.id, name: item.name, dt: item.dt },
    }
  })
}

// ============================================================
// 咪咕 (mg)
// ============================================================
async function searchMg(keyword, limit) {
  const time = Date.now().toString()
  const { sign, deviceId } = createMgSignature(time, keyword)
  const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?` +
    `isCorrect=0&isCopyright=1` +
    `&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D` +
    `&pageSize=${encodeURIComponent(limit)}` +
    `&text=${encodeURIComponent(keyword)}` +
    `&pageNo=1&sort=0&sid=USS`
  const result = await simpleFetch(url, {
    method: 'get',
    headers: {
      uiVersion: 'A_music_3.6.1',
      deviceId,
      timestamp: time,
      sign,
      channel: '0146921',
      'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    },
  })
  if (!result || result.code !== '000000') throw new Error('mg: code != 000000')
  const songResultData = result.songResultData || { resultList: [], totalCount: 0 }
  const rawList = songResultData.resultList || []
  const list = []
  const ids = new Set()
  for (const items of rawList) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (!item.songId || !item.copyrightId || ids.has(item.copyrightId)) continue
      ids.add(item.copyrightId)
      const singerName = item.singerList && Array.isArray(item.singerList)
        ? item.singerList.map(s => s.name).filter(Boolean).join('、')
        : (item.singerName || '')
      list.push({
        source: 'mg',
        songmid: item.songId,
        copyrightId: item.copyrightId,
        name: item.name,
        singer: singerName,
        albumId: item.albumId,
        albumName: item.album || '',
        _raw: { songId: item.songId, copyrightId: item.copyrightId, name: item.name, albumId: item.albumId },
      })
    }
  }
  return list
}

// ============================================================
// id 格式分析
// ============================================================
function analyzeId(id) {
  if (id == null) return { type: 'null', len: 0, sample: '' }
  const s = String(id)
  const len = s.length
  let type
  if (/^\d+$/.test(s)) type = '纯数字'
  else if (/^[a-zA-Z0-9]+$/.test(s)) type = '字母数字'
  else if (/^[a-zA-Z0-9+/=_-]+$/.test(s)) type = '含特殊符号'
  else type = '其他'
  return { type, len, sample: s }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const keyword = process.argv[2] || '周杰伦'
  const limit = parseInt(process.argv[3] || '20', 10)
  console.log(`\n========================================`)
  console.log(`搜索关键词: ${keyword}  每源数量: ${limit}`)
  console.log(`========================================\n`)

  const sources = [
    
    { key: 'kg', fn: searchKg },
    { key: 'kw', fn: searchKw },
    { key: 'tx', fn: searchTx },
    { key: 'wy', fn: searchWy },
    { key: 'mg', fn: searchMg },
  ]

  const allResults = {}        // 各源归一化后的歌曲列表
  const rawSamples = {}        // 各源原始返回样本（前3条）
  const idStats = {}           // 各源 id 格式统计
  const failures = {}

  for (const { key, fn } of sources) {
    process.stdout.write(`[${key}] 搜索中... `)
    try {
      const list = await fn(keyword, limit)
      allResults[key] = list
      rawSamples[key] = list.slice(0, 3).map(s => s._raw)
      // 统计 id 格式
      const stats = { 纯数字: 0, 字母数字: 0, 含特殊符号: 0, 其他: 0, 长度分布: {} }
      for (const item of list) {
        const a = analyzeId(item.songmid)
        stats[a.type] = (stats[a.type] || 0) + 1
        const lenKey = `${a.len}位`
        stats.长度分布[lenKey] = (stats.长度分布[lenKey] || 0) + 1
      }
      idStats[key] = stats
      console.log(`成功 ${list.length} 条`)
    } catch (e) {
      failures[key] = e.message
      allResults[key] = []
      console.log(`失败: ${e.message}`)
    }
  }

  // ---------- 保存原始数据到文件 ----------
  const outDir = path.join(__dirname, 'search-id-output')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
  const outFile = path.join(outDir, `search-${ts}.json`)
  const report = {
    keyword,
    limit,
    timestamp: ts,
    idStats,
    failures,
    rawSamples,
    songs: allResults,
  }
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n原始数据已保存: ${outFile}`)

  // ---------- 打印 id 格式统计 ----------
  console.log(`\n========================================`)
  console.log(`各源 songmid 格式统计`)
  console.log(`========================================`)
  for (const key of ['kw', 'kg', 'tx', 'wy', 'mg']) {
    if (!idStats[key]) continue
    const s = idStats[key]
    console.log(`\n[${key}] 共 ${allResults[key].length} 条`)
    console.log(`  格式: 纯数字=${s['纯数字']}, 字母数字=${s['字母数字']}, 含特殊符号=${s['含特殊符号']}, 其他=${s['其他']}`)
    console.log(`  长度分布: ${JSON.stringify(s.长度分布)}`)
    // 打印前3个样本
    const samples = (allResults[key] || []).slice(0, 3).map(i => i.songmid)
    console.log(`  样本: ${JSON.stringify(samples)}`)
  }

  // ---------- 跨源碰撞检测 ----------
  console.log(`\n========================================`)
  console.log(`跨源 songmid 碰撞检测`)
  console.log(`========================================`)
  // 按 songmid 分组，记录每个 songmid 出现在哪些源
  const songmidMap = {}  // songmid -> [source...]
  for (const key of Object.keys(allResults)) {
    for (const item of allResults[key]) {
      const mid = String(item.songmid)
      if (!songmidMap[mid]) songmidMap[mid] = []
      if (!songmidMap[mid].includes(key)) songmidMap[mid].push(key)
    }
  }
  const collisions = []
  for (const [mid, srcs] of Object.entries(songmidMap)) {
    if (srcs.length > 1) collisions.push({ songmid: mid, sources: srcs })
  }

  if (collisions.length === 0) {
    console.log(`\n未发现跨源 songmid 碰撞（样本量可能不足）`)
  } else {
    console.log(`\n发现 ${collisions.length} 个跨源碰撞的 songmid:`)
    for (const c of collisions.slice(0, 20)) {
      console.log(`  songmid="${c.songmid}" 出现在源: ${c.sources.join(', ')}`)
      // 打印碰撞歌曲的名称以供人工核对
      for (const src of c.sources) {
        const item = allResults[src].find(i => String(i.songmid) === c.songmid)
        if (item) console.log(`    [${src}] ${item.name} - ${item.singer}`)
      }
    }
  }

  // ---------- 候选 id 方案对比 ----------
  console.log(`\n========================================`)
  console.log(`候选 id 方案唯一性对比`)
  console.log(`========================================`)
  // 方案A: 纯 songmid（当前 getStarred/search 的做法）
  // 方案B: source-songmid（stream 期望的格式）
  // 方案C: source-songmid-hash（kg 用 hash，tx 用 strMediaMid 等）
  const schemes = {
    'A: 纯songmid(当前)': new Set(),
    'B: source-songmid': new Set(),
    'C: source-songmid-辅助id': new Set(),
  }
  let totalA = 0, totalB = 0, totalC = 0
  for (const key of Object.keys(allResults)) {
    for (const item of allResults[key]) {
      const a = String(item.songmid)
      const b = `${key}-${item.songmid}`
      // 辅助 id: kg 用 hash, tx 用 strMediaMid, mg 用 copyrightId, 其他用 songmid
      let aux = item.songmid
      if (key === 'kg' && item.hash) aux = item.hash
      else if (key === 'tx' && item.strMediaMid) aux = item.strMediaMid
      else if (key === 'mg' && item.copyrightId) aux = item.copyrightId
      const c = `${key}-${item.songmid}-${aux}`
      schemes['A: 纯songmid(当前)'].add(a)
      schemes['B: source-songmid'].add(b)
      schemes['C: source-songmid-辅助id'].add(c)
      totalA++; totalB++; totalC++
    }
  }
  for (const [name, set] of Object.entries(schemes)) {
    const total = name.startsWith('A') ? totalA : name.startsWith('B') ? totalB : totalC
    const dup = total - set.size
    console.log(`  ${name}: 总数=${total}, 去重后=${set.size}, 重复=${dup} ${dup === 0 ? '✓ 唯一' : '✗ 有重复'}`)
  }

  console.log(`\n========================================`)
  console.log(`分析完成`)
  console.log(`========================================`)
  console.log(`结论建议:`)
  console.log(`  - 若方案B(source-songmid)重复=0，说明加 source 前缀即可解决跨源碰撞`)
  console.log(`  - 若方案B仍有重复，需用方案C(加辅助id)或换用更唯一的字段`)
  console.log(`  - 详细数据见: ${outFile}\n`)
}

main().catch(e => {
  console.error('测试脚本异常:', e && e.message)
  console.error(e && e.stack)
  process.exit(1)
})
