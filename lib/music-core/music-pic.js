/**
 * 音乐封面获取模块 - 支持多个音源
 * 参考 LX Music Desktop 的 pic 实现（src/renderer/utils/musicSdk/<source>/pic.js）
 *
 * 设计思路：
 * - wy/mg：搜索时已将封面 URL 存入 musicInfo.img，直接读取，零请求
 * - tx：用 albumMid 按规则拼接 URL，零请求
 * - kw：调用酷我专用图片接口
 * - kg：POST 酷狗资源权限接口，解析返回地址
 *
 * 统一返回图片 URL 字符串（http/https）或 null
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { simpleFetch } = require('./request')

// ============================================================
// 网易云音乐：搜索时已将 album.picUrl 存入 musicInfo.img
// ============================================================
function wyPic(musicInfo) {
  return musicInfo.img || null
}

// ============================================================
// 咪咕音乐：搜索时已将 img3/img2/img1 存入 musicInfo.img
// ============================================================
function mgPic(musicInfo) {
  return musicInfo.img || null
}

// ============================================================
// QQ音乐：用 albumMid 直接拼接封面 URL（无需请求）
// 参考 lx-music tx/musicInfo.js 的封面拼接逻辑
// ============================================================
function txPic(musicInfo) {
  const mid = musicInfo.albumMid || musicInfo.albumId
  if (!mid) return null
  return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${mid}.jpg`
}

// ============================================================
// 酷我音乐：调用专用图片接口
// 参考 lx-music kw/pic.js
// 接口返回纯文本 URL（非 JSON），simpleFetch 解析失败后保留为字符串
// ============================================================
async function kwPic(musicInfo) {
  if (!musicInfo.songmid) return null
  const url = `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${musicInfo.songmid}`
  const body = await simpleFetch(url, { method: 'get' })
  if (typeof body === 'string' && /^http/.test(body.trim())) return body.trim()
  return null
}

// ============================================================
// 酷狗音乐：POST 资源权限接口，解析返回的图片地址
// 参考 lx-music kg/pic.js
// 返回的 image 含 {size} 占位符，需用 imgsize[0] 替换
// ============================================================
async function kgPic(musicInfo) {
  if (!musicInfo.songmid || (!musicInfo.hash && !musicInfo.albumId)) return null
  const body = await simpleFetch('http://media.store.kugou.com/v1/get_res_privilege', {
    method: 'post',
    json: true,
    body: {
      appid: 1001,
      area_code: '1',
      behavior: 'play',
      clientver: '9020',
      need_hash_offset: 1,
      relate: 1,
      resource: [
        {
          // HollyMusic 的 kg songmid 为 Audioid（数字 id），直接使用
          album_audio_id: musicInfo.songmid,
          album_id: musicInfo.albumId,
          hash: musicInfo.hash,
          id: 0,
          name: `${musicInfo.singer} - ${musicInfo.name}.mp3`,
          type: 'audio',
        },
      ],
      token: '',
      userid: 2626431536,
      vip: 1,
    },
    headers: {
      'KG-RC': 1,
      'KG-THash': 'expand_search_manager.cpp:852736169:451',
      'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
    },
  })

  if (!body || body.error_code !== 0) return null
  const info = body.data && body.data[0] && body.data[0].info
  if (!info) return null
  const img = info.imgsize ? info.image.replace('{size}', info.imgsize[0]) : info.image
  return img || null
}

const picHandlers = {
  wy: wyPic,
  mg: mgPic,
  tx: txPic,
  kw: kwPic,
  kg: kgPic,
}

/**
 * 统一封面获取接口
 * @param {object} musicInfo - 音乐信息（需包含 source 及各源所需字段）
 * @returns {Promise<string|null>} 图片 URL（http/https）或 null
 */
async function getPic(musicInfo) {
  if (!musicInfo || !musicInfo.source) return null
  const handler = picHandlers[musicInfo.source]
  if (!handler) return null
  try {
    const result = await handler(musicInfo)
    if (result && typeof result === 'string' && result.trim()) return result.trim()
    return null
  } catch {
    return null
  }
}

module.exports = { getPic }
