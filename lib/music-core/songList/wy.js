// server-side CommonJS port of lx's wy/songList.js
// Uses existing lib/music-core/wy-eapi.js for eapi crypto
const { simpleFetch, httpFetch } = require('../request')
const { eapi } = require('../wy-eapi')
const { weapi } = require('../weapi')
const { eapiRequest } = require('../wy-eapi-request')

const { formatPlayTime, sizeFormate, dateFormat, formatPlayCount, formatSingerName } = require('../utils')

const wy = {
  _requestObj_tags: null,
  _requestObj_hotTags: null,
  _requestObj_list: null,
  limit_list: 30,
  limit_song: 100000,
  successCode: 200,
  cookie: 'MUSIC_U=',
  sortList: [{ name: '最热', id: 'hot' }],
  regExps: {
    listDetailLink: /^.+(?:\?|&)id=(\d+)(?:&.*$|#.*$|$)/,
    listDetailLink2: /^.+\/playlist\/(\d+)\/\d+\/.+$/,
  },

  async handleParseId(link, retryNum = 0) {
    if (retryNum > 2) throw new Error('link try max num')
    const requestObj_listDetail = httpFetch(link)
    const { headers: { location }, statusCode } = await requestObj_listDetail.promise
    if (statusCode > 400) return this.handleParseId(link, ++retryNum)
    const url = location == null ? link : location
    return this.regExps.listDetailLink.test(url)
      ? url.replace(this.regExps.listDetailLink, '$1')
      : url.replace(this.regExps.listDetailLink2, '$1')
  },

  async getListId(id) {
    let cookie
    if (/###/.test(id)) {
      const [url, token] = id.split('###')
      id = url
      cookie = `MUSIC_U=${token}`
    }
    if ((/[?&:\/]/.test(id))) {
      if (this.regExps.listDetailLink.test(id)) {
        id = id.replace(this.regExps.listDetailLink, '$1')
      } else if (this.regExps.listDetailLink2.test(id)) {
        id = id.replace(this.regExps.listDetailLink2, '$1')
      } else {
        id = await this.handleParseId(id)
      }
    }
    return { id, cookie }
  },

  async getListDetail(rawId, page, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    const { id, cookie } = await this.getListId(rawId)
    if (cookie) this.cookie = cookie

    // prefer eapi call to /api/v3/playlist/detail (eapi encrypts payload)
    try {
      const eapiReq = eapiRequest('/api/v3/playlist/detail', { id, n: this.limit_song, s: 8 }, { timeout: 10000 })
      const { body } = await eapiReq.promise
      if (!body || body.code !== this.successCode) return this.getListDetail(id, page, ++tryNum)
      // assign to body for downstream
      var respBody = body
    } catch {
      return this.getListDetail(id, page, ++tryNum)
    }

    let limit = 1000
    let rangeStart = (page - 1) * limit
    let list
    if (respBody.playlist.trackIds.length == respBody.privileges.length) {
      list = this.filterListDetail(respBody)
    } else {
      // fallback: try to request details in batches via music detail endpoint if available
      try {
        const ids = respBody.playlist.trackIds.slice(rangeStart, limit * page).map(t => t.id)
        // if musicDetail module exists under ../music-detail, call it; otherwise attempt simple mapping
        let detailList = []
        try {
          const musicDetail = require('../musicDetail')
          detailList = (await musicDetail.getList(ids)).list
        } catch {
          // fallback minimal mapping
          detailList = []
        }
        list = detailList
      } catch (err) {
        if (err.message == 'try max num') throw err
        return this.getListDetail(id, page, ++tryNum)
      }
    }

    return {
      list,
      page,
      limit,
      total: respBody.playlist.trackIds.length,
      source: 'wy',
      info: {
        play_count: formatPlayCount(respBody.playlist.playCount),
        name: respBody.playlist.name,
        img: respBody.playlist.coverImgUrl,
        desc: respBody.playlist.description,
        author: respBody.playlist.creator.nickname,
      },
    }
  },

  filterListDetail({ playlist: { tracks }, privileges }) {
    const list = []
    tracks.forEach((item, index) => {
      const types = []
      const _types = {}
      let size
      let privilege = privileges[index]
      if (privilege?.id !== item.id) privilege = privileges.find(p => p.id === item.id)
      if (!privilege) return

      if (privilege.maxBrLevel == 'hires') {
        size = item.hr ? sizeFormate(item.hr.size) : null
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = { size }
      }
      switch (privilege.maxbr) {
        case 999000:
          types.push({ type: 'flac', size: null })
          _types.flac = { size: null }
        case 320000:
          size = item.h ? sizeFormate(item.h.size) : null
          types.push({ type: '320k', size })
          _types['320k'] = { size }
        case 192000:
        case 128000:
          size = item.l ? sizeFormate(item.l.size) : null
          types.push({ type: '128k', size })
          _types['128k'] = { size }
      }
      if (types.length) types.reverse()

      list.push({
        singer: formatSingerName(item.ar, 'name'),
        name: item.name ?? '',
        albumName: item.al?.name,
        albumId: item.al?.id,
        source: 'wy',
        interval: formatPlayTime(item.dt / 1000),
        songmid: item.id,
        img: item.al?.picUrl,
        lrc: null,
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      })
    })
    return list
  },

  getList(sortId, tagId, page, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    if (this._requestObj_list) this._requestObj_list.cancelHttp()
    this._requestObj_list = httpFetch('https://music.163.com/weapi/playlist/list', {
      method: 'post',
      form: { // caller should wrap with weapi when available
        cat: tagId || '全部',
        order: sortId,
        limit: this.limit_list,
        offset: this.limit_list * (page - 1),
        total: true,
      },
    })
    return this._requestObj_list.promise.then(({ body }) => {
      if (body.code !== this.successCode) return this.getList(sortId, tagId, page, ++tryNum)
      return { list: this.filterList(body.playlists), total: parseInt(body.total), page, limit: this.limit_list, source: 'wy' }
    })
  },

  filterList(rawData) {
    return rawData.map(item => ({
      play_count: formatPlayCount(item.playCount),
      id: String(item.id),
      author: item.creator.nickname,
      name: item.name,
      time: item.createTime ? dateFormat(item.createTime, 'Y-M-D') : '',
      img: item.coverImgUrl,
      grade: item.grade,
      total: item.trackCount,
      desc: item.description,
      source: 'wy',
    }))
  },

  getTag(tryNum = 0) {
    if (tryNum > 2) return Promise.resolve([])
    const form = weapi({})
    const bodyStr = `params=${encodeURIComponent(form.params)}&encSecKey=${encodeURIComponent(form.encSecKey)}`
    this._requestObj_tags = httpFetch('https://music.163.com/weapi/playlist/catalogue', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://music.163.com/',
        Origin: 'https://music.163.com',
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.cookie,
      },
      body: bodyStr,
    })
    return this._requestObj_tags.promise.then(({ statusCode, body }) => {
      if (statusCode !== 200) {
        console.error('getTag: non-200', statusCode)
        if (body) console.error('getTag body:', String(body).slice(0, 800))
        return this.getTag(++tryNum)
      }
      if (!body || body.code !== this.successCode) {
        console.error('getTag: unexpected body', JSON.stringify(body).slice(0, 800))
        return this.getTag(++tryNum)
      }
      return this.filterTagInfo(body)
    }).catch(err => {
      console.error('getTag: request error', err && err.message)
      return this.getTag(++tryNum)
    })
  },

  filterTagInfo({ sub, categories }) {
    const subList = {}
    for (const item of sub) {
      if (!subList[item.category]) subList[item.category] = []
      subList[item.category].push({ parent_id: categories[item.category], parent_name: categories[item.category], id: item.name, name: item.name, source: 'wy' })
    }
    const list = []
    for (const key of Object.keys(categories)) list.push({ name: categories[key], list: subList[key], source: 'wy' })
    return list
  },

  getHotTag(tryNum = 0) {
    if (tryNum > 2) return Promise.resolve([])
    const form = weapi({})
    const bodyStr2 = `params=${encodeURIComponent(form.params)}&encSecKey=${encodeURIComponent(form.encSecKey)}`
    this._requestObj_hotTags = httpFetch('https://music.163.com/weapi/playlist/hottags', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://music.163.com/',
        Origin: 'https://music.163.com',
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: this.cookie,
      },
      body: bodyStr2,
    })
    return this._requestObj_hotTags.promise.then(({ statusCode, body }) => {
      if (statusCode !== 200) {
        console.error('getHotTag: non-200', statusCode)
        if (body) console.error('getHotTag body:', String(body).slice(0, 800))
        return this.getHotTag(++tryNum)
      }
      if (!body || body.code !== this.successCode) {
        console.error('getHotTag: unexpected body', JSON.stringify(body).slice(0, 800))
        return this.getHotTag(++tryNum)
      }
      return this.filterHotTagInfo(body.tags)
    }).catch(err => {
      console.error('getHotTag: request error', err && err.message)
      return this.getHotTag(++tryNum)
    })
  },

  filterHotTagInfo(rawList) { return rawList.map(item => ({ id: item.playlistTag.name, name: item.playlistTag.name, source: 'wy' })) },

  getTags() { return Promise.all([this.getTag(), this.getHotTag()]).then(([tags, hotTag]) => ({ tags, hotTag, source: 'wy' })) },

  async getDetailPageUrl(rawId) { const { id } = await this.getListId(rawId); return `https://music.163.com/#/playlist?id=${id}` },

  search(text, page, limit = 20) {
    return eapiRequest('/api/cloudsearch/pc', { s: text, type: 1000, limit, total: page == 1, offset: limit * (page - 1) })
      .promise.then(({ body }) => {
        if (body.code != this.successCode) throw new Error('failed')
        return { list: this.filterList(body.result.playlists), limit, total: body.result.playlistCount, source: 'wy' }
      })
  },
}

module.exports = wy
