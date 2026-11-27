import { searchCache } from '@/lib/cache-manager'
import { mergeQualityInfos, neteaseExtendedQualities, qqExtendedQualities, qualityFromBytes } from '@/lib/platform-qualities'
import type { MusicInfo, QualityInfo, QualityType } from '@/lib/types/music'

const pending = new Map<string, Promise<QualityInfo[]>>()
const KUGOU_QUALITIES: Partial<Record<string, QualityType>> = {
  high: 'flac24bit', viper_clear: 'master', viper_tape: 'master', viper_atmos: 'atmos', dolby: 'atmos',
}

async function loadAudioDetails(music: MusicInfo): Promise<QualityInfo[]> {
  const signal = AbortSignal.timeout(2500)
  if (music.source === 'tx' && /^[\w-]{1,64}$/.test(music.songmid)) {
    const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comm: { ct: '19', cv: '1859', uin: '0' },
        req: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq',
          param: { song_type: 0, song_mid: music.songmid } } }),
    })
    if (!response.ok) throw new Error('QQ 音质详情请求失败')
    const body = await response.json()
    const file = body.req?.data?.track_info?.file
    if (!file) throw new Error('QQ 音质详情缺失')
    const hires = qualityFromBytes('flac24bit', file.size_hires)
    return [...(hires ? [hires] : []), ...qqExtendedQualities(file.size_new)]
  }
  if (music.source === 'wy' && /^\d{1,24}$/.test(music.songmid)) {
    const response = await fetch('https://music.163.com/api/song/music/detail/get?songId=' + music.songmid, { signal })
    if (!response.ok) throw new Error('网易音质详情请求失败')
    const body = await response.json()
    if (body.code !== 200 || !body.data) throw new Error('网易音质详情缺失')
    return neteaseExtendedQualities(body.data)
  }
  if (music.source === 'kg' && music.hash && /^[a-f\d]{32}$/i.test(music.hash)) {
    const endpoint = new URL('https://gateway.kugou.com/goodsmstore/v1/get_res_privilege')
    endpoint.search = new URLSearchParams({ appid: '1005', clientver: '20049', clienttime: String(Date.now()), mid: 'NeZha' }).toString()
    const response = await fetch(endpoint, {
      signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ behavior: 'play', clientver: '20049', area_code: '1', quality: '128',
        resource: [{ id: 0, type: 'audio', hash: music.hash }], qualities: ['128', ...Object.keys(KUGOU_QUALITIES)] }),
    })
    if (!response.ok) throw new Error('酷狗音质详情请求失败')
    const body = await response.json()
    const goods = body.data?.[0]?.relate_goods
    if (Number(body.error_code) !== 0 || !Array.isArray(goods)) throw new Error('酷狗音质详情缺失')
    const qualities = new Map<QualityType, QualityInfo>()
    for (const item of goods) {
      const type = KUGOU_QUALITIES[item?.quality]
      if (!type || typeof item.hash !== 'string' || !/^[a-f\d]{32}$/i.test(item.hash)) continue
      const descriptor = qualityFromBytes(type, item.info?.filesize, item.hash) ?? { type, size: '', hash: item.hash }
      if (!qualities.has(type) || item.quality === 'viper_tape') qualities.set(type, descriptor)
    }
    return [...qualities.values()]
  }
  return []
}

/** 歌曲缺少新档位信息时短期补查。上游不可用时保留旧歌曲信息，继续使用音源验证。 */
export async function enrichAudioDetails(music: MusicInfo, quality?: QualityType): Promise<MusicInfo> {
  if (!['tx', 'wy', 'kg'].includes(music.source)) return music
  if (quality && (music._types?.[quality] || !['master', 'flac24bit', 'atmos', 'atmos_plus'].includes(quality))) return music
  const key = `search:v3:audio-details:${music.source}:${music.hash ?? music.songmid}`
  let details = searchCache.get(key) as QualityInfo[] | null
  if (!details) {
    let operation = pending.get(key)
    if (!operation) {
      operation = loadAudioDetails(music).then(items => {
        searchCache.set(key, items, 10 * 60_000)
        return items
      }).catch(() => {
        searchCache.set(key, [], 30_000)
        return []
      }).finally(() => pending.delete(key))
      pending.set(key, operation)
    }
    details = await operation
  }
  if (!details.length) return music
  const types = mergeQualityInfos(music.types, details)
  const _types = { ...music._types }
  for (const item of types) _types[item.type] = { ..._types[item.type], ...item }
  return { ...music, types, _types }
}
