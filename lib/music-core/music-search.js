/**
 * 音乐搜索模块 - 支持多个音源
 * 基于 LX Music Desktop 的搜索实现
 */

const { simpleFetch } = require('./request')
const crypto = require('crypto')

/**
 * 格式化播放时长
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时长，如 "03:45"
 */
function formatPlayTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00'
  const sec = Math.floor(seconds)
  const min = Math.floor(sec / 60)
  const hour = Math.floor(min / 60)
  
  if (hour > 0) {
    return `${hour.toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`
  }
  return `${min.toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小，如 "3.5M"
 */
function sizeFormate(bytes) {
  if (!bytes || bytes === 0) return '0B'
  const k = 1024
  const sizes = ['B', 'K', 'M', 'G', 'T']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + sizes[i]
}

/**
 * 格式化歌手名称
 * @param {Array} singers - 歌手数组
 * @param {string} key - 歌手名称的键名
 * @returns {string} 格式化后的歌手名称，多个歌手用"、"分隔
 */
function formatSingerName(singers, key = 'name') {
  if (!Array.isArray(singers)) return ''
  return singers.map(s => s[key] || s).filter(Boolean).join('、')
}

/**
 * 解码名称（处理特殊字符）
 */
function decodeName(str) {
  if (!str) return ''
  return str.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

// ============================================================
// 公共工具 - MD5 与咪咕签名
// ============================================================
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
// 酷我音乐搜索
// ============================================================
const kwSearch = {
  async search(keyword, page = 1, limit = 30, retryNum = 0) {
    if (retryNum > 2) {
      throw new Error('搜索失败: 已达到最大重试次数')
    }
    
    const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`
    
    const result = await simpleFetch(url, {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    // 如果 TOTAL 不为 '0' 但 SHOW 为 '0'，说明需要重试
    if (!result || (result.TOTAL !== '0' && result.SHOW === '0')) {
      return this.search(keyword, page, limit, retryNum + 1)
    }
    
    const list = []
    const abslist = result.abslist || []
    
    for (const item of abslist) {
      const songId = item.MUSICRID.replace('MUSIC_', '')
      
      // 解析音质信息
      const types = []
      const _types = {}
      
      if (item.N_MINFO) {
        const regExp = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/
        const infoArr = item.N_MINFO.split(';')
        
        for (const info of infoArr) {
          const match = info.match(regExp)
          if (match) {
            const [, level, bitrate, format, size] = match
            switch (bitrate) {
              case '4000':
                types.push({ type: 'flac24bit', size })
                _types.flac24bit = { size: size.toUpperCase() }
                break
              case '2000':
                types.push({ type: 'flac', size })
                _types.flac = { size: size.toUpperCase() }
                break
              case '320':
                types.push({ type: '320k', size })
                _types['320k'] = { size: size.toUpperCase() }
                break
              case '128':
                types.push({ type: '128k', size })
                _types['128k'] = { size: size.toUpperCase() }
                break
            }
          }
        }
      }
      types.reverse()
      
      const duration = parseInt(item.DURATION) || 0
      
      list.push({
        name: decodeName(item.SONGNAME),
        singer: decodeName(item.ARTIST),
        source: 'kw',
        songmid: songId,
        albumId: decodeName(item.ALBUMID || ''),
        albumName: item.ALBUM ? decodeName(item.ALBUM) : '',
        interval: formatPlayTime(duration),
        img: null,
        types,
        _types,
        typeUrl: {},
      })
    }
    
    // 如果列表为空，尝试重试
    if (list.length === 0 && retryNum < 2) {
      return this.search(keyword, page, limit, retryNum + 1)
    }
    
    const total = parseInt(result.TOTAL) || 0
    const allPage = Math.ceil(total / limit)
    
    return {
      list,
      total,
      page,
      allPage,
      limit,
      source: 'kw',
    }
  },
}

// ============================================================
// 酷狗音乐搜索
// ============================================================
const kgSearch = {
  async search(keyword, page = 1, limit = 30, retryNum = 0) {
    if (retryNum >= 3) {
      throw new Error('搜索失败: 已达到最大重试次数')
    }
    
    // 使用原项目的 API（与 mobilecdn 返回的字段一致）
    const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`
    
    const result = await simpleFetch(url, {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    
    if (!result || result.error_code !== 0) {
      return this.search(keyword, page, limit, retryNum + 1)
    }
    
    const rawList = result.data.lists || []
    const list = []
    const ids = new Set()
    
    for (const item of rawList) {
      // 主条目
      const key = item.Audioid + item.FileHash
      if (!ids.has(key)) {
        ids.add(key)
        list.push(this.formatItem(item))
      }
      
      // 分组条目（修复原项目的 bug：应该用 childItem 而不是 item）
      if (item.Grp && Array.isArray(item.Grp)) {
        for (const childItem of item.Grp) {
          const childKey = childItem.Audioid + childItem.FileHash
          if (!ids.has(childKey)) {
            ids.add(childKey)
            list.push(this.formatItem(childItem))
          }
        }
      }
    }
    
    // 如果列表为空，尝试重试
    if (list.length === 0 && retryNum < 2) {
      return this.search(keyword, page, limit, retryNum + 1)
    }
    
    const total = result.data.total || 0
    const allPage = Math.ceil(total / limit)
    
    return {
      list,
      total,
      page,
      allPage,
      limit,
      source: 'kg',
    }
  },
  
  formatItem(item) {
    const types = []
    const _types = {}
    
    if (item.FileSize !== 0) {
      const size = sizeFormate(item.FileSize)
      types.push({ type: '128k', size, hash: item.FileHash })
      _types['128k'] = { size, hash: item.FileHash }
    }
    if (item.HQFileSize !== 0) {
      const size = sizeFormate(item.HQFileSize)
      types.push({ type: '320k', size, hash: item.HQFileHash })
      _types['320k'] = { size, hash: item.HQFileHash }
    }
    if (item.SQFileSize !== 0) {
      const size = sizeFormate(item.SQFileSize)
      types.push({ type: 'flac', size, hash: item.SQFileHash })
      _types.flac = { size, hash: item.SQFileHash }
    }
    if (item.ResFileSize !== 0) {
      const size = sizeFormate(item.ResFileSize)
      types.push({ type: 'flac24bit', size, hash: item.ResFileHash })
      _types.flac24bit = { size, hash: item.ResFileHash }
    }
    
    const singerName = item.Singers 
      ? formatSingerName(item.Singers, 'name')
      : item.SingerName || ''
    
    return {
      name: decodeName(item.SongName),
      singer: decodeName(singerName),
      source: 'kg',
      songmid: item.Audioid,
      hash: item.FileHash,
      albumId: item.AlbumID,
      albumName: decodeName(item.AlbumName),
      interval: formatPlayTime(item.Duration),
      img: null,
      types,
      _types,
      typeUrl: {},
    }
  },
}

// ============================================================
// QQ音乐搜索
// ============================================================
const txSearch = {
  async search(keyword, page = 1, limit = 30) {
    const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
    const postData = {
      comm: {
        ct: 11,
        cv: '1003006',
        v: '1003006',
        os_ver: '12',
        phonetype: '0',
        devicelevel: '31',
        tmeAppID: 'qqmusiclight',
        nettype: 'NETWORK_WIFI',
      },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicLite',
        param: {
          query: keyword,
          search_type: 0,
          num_per_page: limit,
          page_num: page,
          nqc_flag: 0,
          grp: 1,
        },
      },
    }
    
    const result = await simpleFetch(url, {
      method: 'post',
      body: postData,
      json: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
      },
    })
    
    if (!result || result.code !== 0 || result.req.code !== 0) {
      throw new Error('搜索失败')
    }
    
    const rawList = result.req.data.body.item_song || []
    const list = []
    
    for (const item of rawList) {
      if (!item.file?.media_mid) continue
      
      const types = []
      const _types = {}
      const file = item.file
      
      if (file.size_128mp3 !== 0) {
        const size = sizeFormate(file.size_128mp3)
        types.push({ type: '128k', size })
        _types['128k'] = { size }
      }
      if (file.size_320mp3 !== 0) {
        const size = sizeFormate(file.size_320mp3)
        types.push({ type: '320k', size })
        _types['320k'] = { size }
      }
      if (file.size_flac !== 0) {
        const size = sizeFormate(file.size_flac)
        types.push({ type: 'flac', size })
        _types.flac = { size }
      }
      if (file.size_hires !== 0) {
        const size = sizeFormate(file.size_hires)
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = { size }
      }
      
      const albumName = item.album?.name || ''
      const albumId = item.album?.mid || ''
      const albumMid = item.album?.mid || ''
      
      list.push({
        name: item.name + (item.title_extra || ''),
        singer: formatSingerName(item.singer, 'name'),
        source: 'tx',
        songmid: item.mid,
        songId: item.id,
        strMediaMid: file.media_mid,
        albumId,
        albumMid,
        albumName,
        interval: formatPlayTime(item.interval),
        img: null,
        types,
        _types,
        typeUrl: {},
      })
    }
    
    const total = result.req.data.meta.sum || 0
    const allPage = Math.ceil(total / limit)
    
    return {
      list,
      total,
      page,
      allPage,
      limit,
      source: 'tx',
    }
  },
}

// ============================================================
// 网易云音乐搜索（参考 renderer 实现，使用 cloudsearch/pc）
// ============================================================
const wySearch = {
  async search(keyword, page = 1, limit = 30, retryNum = 0) {
    if (retryNum >= 3) {
      throw new Error('搜索失败: 已达到最大重试次数')
    }

    // 参考 src/renderer/utils/musicSdk/wy/musicSearch.js
    // 通过 eapi batch 调用 cloudsearch/pc 接口
    const apiPath = '/api/cloudsearch/pc'
    const body = {
      s: keyword,
      type: 1, // 单曲
      limit,
      total: page === 1,
      offset: limit * (page - 1),
    }

    const { eapi } = require('./wy-eapi')
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

    if (!result || result.code !== 200) {
      return this.search(keyword, page, limit, retryNum + 1)
    }

    const rawList = (result.result && result.result.songs) || []
    const list = []

    for (const item of rawList) {
      const types = []
      const _types = {}

      // 依据 privilege 与各档音质对象(hr/sq/h/l)生成类型，参考 renderer 逻辑
      if (item.privilege && item.privilege.maxBrLevel === 'hires') {
        const size = item.hr ? sizeFormate(item.hr.size) : null
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = { size }
      }

      if (item.privilege && item.privilege.maxbr) {
        switch (item.privilege.maxbr) {
          case 999000: {
            const size = item.sq ? sizeFormate(item.sq.size) : null
            types.push({ type: 'flac', size })
            _types.flac = { size }
          }
          // fallthrough 320k
          case 320000: {
            const size = item.h ? sizeFormate(item.h.size) : null
            types.push({ type: '320k', size })
            _types['320k'] = { size }
          }
          // fallthrough 192k/128k -> 128k
          case 192000:
          case 128000: {
            const size = item.l ? sizeFormate(item.l.size) : null
            types.push({ type: '128k', size })
            _types['128k'] = { size }
          }
        }
      }

      // 反转与 renderer 一致
      if (types.length) types.reverse()

      const singers = Array.isArray(item.ar) ? item.ar.map(s => s.name).filter(Boolean).join('、') : ''
      const album = item.al || {}

      list.push({
        singer: singers,
        name: item.name,
        albumName: album.name || '',
        albumId: album.id,
        source: 'wy',
        interval: formatPlayTime((item.dt || 0) / 1000),
        songmid: String(item.id),
        img: album.picUrl || null,
        lrc: null,
        types,
        _types,
        typeUrl: {},
      })
    }

    if (list.length === 0 && retryNum < 2) {
      return this.search(keyword, page, limit, retryNum + 1)
    }

    const total = (result.result && result.result.songCount) || 0
    const allPage = Math.ceil(total / limit)

    return {
      list,
      total,
      page,
      allPage,
      limit,
      source: 'wy',
    }
  },
}

// ============================================================
// 咪咕音乐搜索（参考 renderer 实现：jadeite.migu.cn + 签名）
// ============================================================
const mgSearch = {
  async search(keyword, page = 1, limit = 30, retryNum = 0) {
    if (retryNum >= 3) {
      throw new Error('搜索失败: 已达到最大重试次数')
    }

    const time = Date.now().toString()
    const { sign, deviceId } = createMgSignature(time, keyword)

    const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?` +
      `isCorrect=0&isCopyright=1` +
      `&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D` +
      `&pageSize=${encodeURIComponent(limit)}` +
      `&text=${encodeURIComponent(keyword)}` +
      `&pageNo=${encodeURIComponent(page)}` +
      `&sort=0&sid=USS`

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

    if (!result || result.code !== '000000') {
      return this.search(keyword, page, limit, retryNum + 1)
    }

    const songResultData = result.songResultData || { resultList: [], totalCount: 0 }
    const rawList = songResultData.resultList || []
    const list = []
    const ids = new Set()

    for (const items of rawList) {
      if (!Array.isArray(items)) continue
      for (const item of items) {
        if (!item.songId || !item.copyrightId || ids.has(item.copyrightId)) continue
        ids.add(item.copyrightId)

        const types = []
        const _types = {}
        if (item.audioFormats && Array.isArray(item.audioFormats)) {
          item.audioFormats.forEach(format => {
            const size = sizeFormate(format.asize ?? format.isize ?? 0)
            switch (format.formatType) {
              case 'PQ':
                types.push({ type: '128k', size })
                _types['128k'] = { size }
                break
              case 'HQ':
                types.push({ type: '320k', size })
                _types['320k'] = { size }
                break
              case 'SQ':
                types.push({ type: 'flac', size })
                _types.flac = { size }
                break
              case 'ZQ24':
                types.push({ type: 'flac24bit', size })
                _types.flac24bit = { size }
                break
            }
          })
        }

        let img = item.img3 || item.img2 || item.img1 || null
        if (img && !/https?:/.test(img)) img = 'http://d.musicapp.migu.cn' + img

        const singerName = item.singerList && Array.isArray(item.singerList)
          ? item.singerList.map(s => s.name).filter(Boolean).join('、')
          : item.singerName || ''

        list.push({
          name: item.name,
          singer: singerName,
          source: 'mg',
          songmid: item.songId,
          copyrightId: item.copyrightId,
          albumId: item.albumId,
          albumName: item.album || '',
          interval: formatPlayTime(item.duration || 0),
          img,
          lrcUrl: item.lrcUrl,
          mrcUrl: item.mrcurl,
          trcUrl: item.trcUrl,
          types,
          _types,
          typeUrl: {},
        })
      }
    }

    if (list.length === 0 && retryNum < 2) {
      return this.search(keyword, page, limit, retryNum + 1)
    }

    const total = parseInt(songResultData.totalCount) || 0
    const allPage = Math.ceil(total / limit)

    return {
      list,
      total,
      page,
      allPage,
      limit,
      source: 'mg',
    }
  },
}

// ============================================================
// 导出搜索模块
// ============================================================
export const kw = kwSearch
export const kg = kgSearch
export const tx = txSearch
export const wy = wySearch
export const mg = mgSearch
export
  /**
   * 统一搜索接口
   * @param {string} source - 音源 (kw/kg/tx/wy/mg)
   * @param {string} keyword - 搜索关键词
   * @param {number} page - 页码
   * @param {number} limit - 每页数量
   */
  async function search(source, keyword, page = 1, limit = 30) {
  const searcher = this[source]
  if (!searcher) {
    throw new Error(`不支持的音源: ${source}`)
  }
  return searcher.search(keyword, page, limit)
}
