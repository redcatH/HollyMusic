/**
 * QQ 搜索请求，移植自 LX Music Desktop v2.12.6（21619e72）。
 * Desktop 接口、客户端参数与 zzc 签名需一起更新。
 */
const crypto = require('node:crypto')
const request = require('./request')

const SEARCH_MODULE = 'music.search.SearchCgiService'
const MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT = 5000
const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

function zzcSign(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex')
  const part1 = PART_1_INDEXES.map(index => hash[index]).join('')
  const part2 = PART_2_INDEXES.map(index => hash[index]).join('')
  const scrambled = SCRAMBLE_VALUES.map((value, index) => value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16))
  const part3 = Buffer.from(scrambled).toString('base64').replace(/[\\/+=]/g, '')
  return `zzc${part1}${part3}${part2}`.toLowerCase()
}

/** @returns {Promise<object>} 已校验的 QQ 搜索数据（body + meta）。 */
async function searchTx(keyword, page, limit) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 每次重试使用新的会话 ID；签名和实际发送的 JSON 必须完全一致。
    const body = JSON.stringify({
      comm: {
        _channelid: '0',
        _os_version: '6.2.9200-2',
        ct: '19',
        cv: '2151',
        guid: '1F70E520B2EAA7D25E11760783C53CA9',
        patch: '118',
        psrf_access_token_expiresAt: 0,
        psrf_qqaccess_token: '',
        psrf_qqopenid: '',
        psrf_qqunionid: '',
        tmeAppID: 'qqmusic',
        tmeLoginType: 0,
        uin: '0',
        wid: '7223299733393904640',
      },
      [SEARCH_MODULE]: {
        module: SEARCH_MODULE,
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: limit,
          page_num: page,
          query: keyword,
          remoteplace: 'txt.newclient.top',
          search_type: 0,
          searchid: crypto.randomBytes(16).toString('hex').toUpperCase() + String(crypto.randomInt(100000)).padStart(5, '0'),
        },
      },
    })

    let failure
    let retryable = true
    try {
      const response = await request.httpFetch(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${zzcSign(body)}`, {
        method: 'post',
        body,
        json: true,
        timeout: REQUEST_TIMEOUT,
        read_timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'QQMusic 14090508(android 12)',
          'Content-Type': 'application/json',
        },
      }).promise
      const result = response.body
      const req = result?.[SEARCH_MODULE] ?? result?.req
      const data = req?.data
      const songs = data?.body?.song?.list ?? data?.body?.item_song
      const httpOk = response.statusCode >= 200 && response.statusCode < 300
      const apiOk = [0, '0'].includes(result?.code) && [0, '0'].includes(req?.code)

      if (httpOk && apiOk && Array.isArray(songs)) return data

      retryable = httpOk || response.statusCode === 429 || response.statusCode >= 500
      const reason = !httpOk ? 'HTTP 请求失败'
        : !apiOk ? '上游拒绝请求或返回异常'
          : '响应缺少歌曲列表'
      failure = new Error(`腾讯搜索失败：${reason}（HTTP ${response.statusCode}, code=${result?.code ?? 'missing'}, req.code=${req?.code ?? 'missing'}）`)
    } catch (error) {
      failure = new Error(`腾讯搜索请求失败：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }

    if (!retryable || attempt === MAX_ATTEMPTS - 1) throw failure
    // 短暂退避，避免风控或网络抖动时立即连续请求。
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
  }
}

module.exports = { searchTx, zzcSign }
