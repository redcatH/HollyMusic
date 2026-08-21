import { logger } from '@/lib/logger'
import type { MusicInfo } from '@/lib/types/music'

export type NativeLyricResult = { lyric: string; tlyric: string | null }

type KuwoLyricLine = {
  time?: unknown
  lineLyric?: unknown
}

type KugouLyricCandidate = {
  id?: unknown
  accesskey?: unknown
  song?: unknown
  singer?: unknown
}

const REQUEST_TIMEOUT = 5_000

function formatLrcTimestamp(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1_000)
  const fraction = total % 1_000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return response.ok ? response : null
  } finally {
    clearTimeout(timeoutId)
  }
}

function decodeBase64(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    return Buffer.from(value, 'base64').toString('utf8').trim()
  } catch {
    return ''
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseIntervalSeconds(interval: string): number {
  const parts = interval.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number(interval) || 0
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function titleMatches(candidate: string, expected: string): boolean {
  const candidateValue = comparable(candidate)
  const expectedValue = comparable(expected)
  return Boolean(candidateValue && expectedValue && (candidateValue.includes(expectedValue) || expectedValue.includes(candidateValue)))
}

function artistMatches(candidate: string, expected: string): boolean {
  const candidateValue = comparable(candidate)
  const expectedValue = comparable(expected)
  if (!candidateValue || !expectedValue) return true
  return candidateValue.includes(expectedValue) || expectedValue.includes(candidateValue)
}

/** 将酷我移动端的 `{ data: { lrclist } }` 响应转换为标准 LRC。 */
export function parseKuwoLyricsPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const lyricList = (data as { lrclist?: unknown }).lrclist
  if (!Array.isArray(lyricList)) return null

  const lines = lyricList
    .filter((line): line is KuwoLyricLine => Boolean(line) && typeof line === 'object')
    .map(line => {
      const content = typeof line.lineLyric === 'string' ? line.lineLyric.trim() : ''
      const seconds = typeof line.time === 'number' ? line.time : Number(line.time)
      if (!content || !Number.isFinite(seconds)) return null
      return `[${formatLrcTimestamp(seconds * 1_000)}]${content}`
    })
    .filter((line): line is string => line !== null)

  return lines.length > 0 ? lines.join('\n') : null
}

function parseMiguMrc(text: string): string | null {
  const lines = text.replace(/\r/g, '').split('\n').flatMap(raw => {
    const match = raw.match(/^\s*\[(\d+),\d+\](.*)$/)
    if (!match) return []
    const lyric = match[2].replace(/\(\d+,\d+\)/g, '').trim()
    return lyric ? [`[${formatLrcTimestamp(Number(match[1]))}]${lyric}`] : []
  })
  return lines.length > 0 ? lines.join('\n') : null
}

/** 咪咕 MRC 的 XXTEA 解密；实现与 lxserver 保持相同的歌曲源协议。 */
function decryptMiguMrc(data: string): string {
  if (data.length < 32) return data

  // tsconfig 仍以 ES2017 为目标，故不用 BigInt 字面量；Node 运行时支持 BigInt。
  const bigint = BigInt
  const zero = bigint(0)
  const one = bigint(1)
  const three = bigint(3)
  const six = bigint(6)
  const fiftyTwo = bigint(52)
  const two = bigint(2)
  const four = bigint(4)
  const five = bigint(5)
  const eight = bigint(8)
  const sixtyFour = bigint(64)
  const byteMask = bigint(255)
  const delta = bigint('2654435769')
  const key = [
    bigint('27303562373562475'), bigint('18014862372307051'), bigint('22799692160172081'),
    bigint('34058940340699235'), bigint('30962724186095721'), bigint('27303523720101991'),
    bigint('27303523720101998'), bigint('31244139033526382'), bigint('28992395054481524'),
  ]
  const max = bigint('9223372036854775807')
  const min = bigint('-9223372036854775808')
  const toLong = (value: bigint): bigint => {
    if (value > max) return toLong(value - (one << sixtyFour))
    if (value < min) return toLong(value + (one << sixtyFour))
    return value
  }
  const values: bigint[] = []
  for (let index = 0; index + 16 <= data.length; index += 16) values.push(toLong(BigInt(`0x${data.slice(index, index + 16)}`)))
  if (!values.length) return data

  let current = values[0]
  let sum = toLong((six + fiftyTwo / bigint(values.length)) * delta)
  while (sum !== zero) {
    const keyIndex = toLong((sum >> two) & three)
    for (let index = values.length - 1; index > 0; index--) {
      const previous = values[index - 1]
      current = toLong(values[index] - (toLong(toLong(current ^ sum) + toLong(previous ^ key[Number((bigint(index) & three) ^ keyIndex)])) ^ toLong(toLong(toLong(previous >> five) ^ toLong(current << two)) + toLong(toLong(current >> three) ^ toLong(previous << four)))))
      values[index] = current
    }
    const last = values[values.length - 1]
    current = toLong(values[0] - (toLong(toLong(key[Number(keyIndex)] ^ last) + toLong(current ^ sum)) ^ toLong(toLong(last >> five ^ current << two) + toLong(current >> three ^ last << four))))
    values[0] = current
    sum = toLong(sum - delta)
  }

  return values.map(value => {
    const buffer = Buffer.alloc(8)
    let remaining = value
    for (let index = 0; index < 8; index++) {
      buffer[index] = Number(remaining & byteMask)
      remaining >>= eight
    }
    return buffer.toString('utf16le')
  }).join('')
}

async function fetchKuwoLyric(songmid: string): Promise<NativeLyricResult | null> {
  const response = await fetchWithTimeout(
    `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(songmid)}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  )
  if (!response) return null
  const lyric = parseKuwoLyricsPayload(await response.json())
  return lyric ? { lyric, tlyric: null } : null
}

async function fetchQQMusicLyric(songmid: string): Promise<NativeLyricResult | null> {
  const params = new URLSearchParams({ songmid, g_tk: '5381', loginUin: '0', hostUin: '0', format: 'json', inCharset: 'utf8', outCharset: 'utf-8', platform: 'yqq' })
  const response = await fetchWithTimeout(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`, {
    headers: { Referer: 'https://y.qq.com/portal/player.html' },
  })
  if (!response) return null
  const payload = await response.json() as { code?: unknown; lyric?: unknown; trans?: unknown }
  if (payload.code !== 0) return null
  const lyric = decodeHtmlEntities(decodeBase64(payload.lyric))
  return lyric ? { lyric, tlyric: decodeHtmlEntities(decodeBase64(payload.trans)) || null } : null
}

async function fetchNeteaseLyric(songmid: string): Promise<NativeLyricResult | null> {
  const params = new URLSearchParams({ id: songmid, lv: '-1', tv: '-1', rv: '-1', kv: '-1' })
  const response = await fetchWithTimeout(`https://music.163.com/api/song/lyric?${params}`, {
    headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
  })
  if (!response) return null
  const payload = await response.json() as { lrc?: { lyric?: unknown }; tlyric?: { lyric?: unknown } }
  const lyric = typeof payload.lrc?.lyric === 'string' ? payload.lrc.lyric.trim() : ''
  return lyric ? { lyric, tlyric: typeof payload.tlyric?.lyric === 'string' ? payload.tlyric.lyric.trim() || null : null } : null
}

async function fetchMiguLyric(musicInfo: MusicInfo): Promise<NativeLyricResult | null> {
  const headers = {
    Referer: 'https://app.c.nf.migu.cn/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 Chrome/59.0.3071.115 Mobile Safari/537.36',
    channel: '0146921',
  }
  const lrcResponse = musicInfo.lrcUrl ? await fetchWithTimeout(musicInfo.lrcUrl, { headers }) : null
  const mrcResponse = !lrcResponse && musicInfo.mrcUrl ? await fetchWithTimeout(musicInfo.mrcUrl, { headers }) : null
  const rawLyric = lrcResponse ? await lrcResponse.text() : mrcResponse ? decryptMiguMrc(await mrcResponse.text()) : ''
  const lyric = lrcResponse ? rawLyric.trim() : parseMiguMrc(rawLyric)
  if (!lyric) return null

  const trcResponse = musicInfo.trcUrl ? await fetchWithTimeout(musicInfo.trcUrl, { headers }) : null
  const tlyric = trcResponse ? (await trcResponse.text()).trim() || null : null
  return { lyric, tlyric }
}

async function fetchKugouLyric(musicInfo: MusicInfo): Promise<NativeLyricResult | null> {
  if (!musicInfo.hash) return null
  const params = new URLSearchParams({
    ver: '1', man: 'yes', client: 'pc', keyword: musicInfo.name, hash: musicInfo.hash,
    timelength: String(parseIntervalSeconds(musicInfo.interval)), lrctxt: '1',
  })
  const headers = {
    'KG-RC': '1',
    'KG-THash': 'expand_search_manager.cpp:852736169:451',
    'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
  }
  const searchResponse = await fetchWithTimeout(`https://lyrics.kugou.com/search?${params}`, { headers })
  if (!searchResponse) return null
  const searchPayload = await searchResponse.json() as { candidates?: unknown }
  const candidate = Array.isArray(searchPayload.candidates)
    ? searchPayload.candidates.find((item): item is KugouLyricCandidate => Boolean(item) && typeof item === 'object' && titleMatches(String((item as KugouLyricCandidate).song || ''), musicInfo.name) && artistMatches(String((item as KugouLyricCandidate).singer || ''), musicInfo.singer))
    : undefined
  if (!candidate?.id || !candidate.accesskey) return null

  const downloadParams = new URLSearchParams({ ver: '1', client: 'pc', id: String(candidate.id), accesskey: String(candidate.accesskey), fmt: 'lrc', charset: 'utf8' })
  const downloadResponse = await fetchWithTimeout(`https://lyrics.kugou.com/download?${downloadParams}`, { headers })
  if (!downloadResponse) return null
  const payload = await downloadResponse.json() as { fmt?: unknown; content?: unknown }
  if (payload.fmt !== 'lrc') return null
  const lyric = decodeBase64(payload.content)
  return lyric ? { lyric, tlyric: null } : null
}

/**
 * 从歌曲所属平台精确取词。实现参考同级 lxserver：先走音源 ID / hash / 歌词 URL，
 * 不可用时才由调用方回退到自定义音源或第三方标题搜索。
 */
export async function fetchNativeLyric(musicInfo: MusicInfo): Promise<NativeLyricResult | null> {
  try {
    let result: NativeLyricResult | null = null
    switch (musicInfo.source) {
      case 'kw':
        if (/^\d+$/.test(String(musicInfo.songmid))) result = await fetchKuwoLyric(String(musicInfo.songmid))
        break
      case 'tx':
        result = await fetchQQMusicLyric(String(musicInfo.songmid))
        break
      case 'wy':
        if (/^\d+$/.test(String(musicInfo.songmid))) result = await fetchNeteaseLyric(String(musicInfo.songmid))
        break
      case 'mg':
        result = await fetchMiguLyric(musicInfo)
        break
      case 'kg':
        result = await fetchKugouLyric(musicInfo)
        break
    }
    if (result) logger.info('[lyrics] fetched precise source lyric', { source: musicInfo.source, songId: musicInfo.songmid, lineCount: result.lyric.split('\n').length })
    return result
  } catch (error) {
    logger.debug('[lyrics] native lyric request failed', { source: musicInfo.source, songId: musicInfo.songmid, error })
    return null
  }
}
