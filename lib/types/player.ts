/**
 * 前端播放器类型定义
 */

import type { MusicInfo, QualityType, SourceType } from './music'

export type PlaybackMode = 'loop' | 'sequence' | 'random'

/**
 * 播放器曲目。统一前端各处使用的歌曲结构。
 * uid 为对外唯一 id（source-存储songmid），用于封面/歌词/收藏/历史。
 */
export interface Track {
  uid: string
  name: string
  artist: string
  album: string
  duration: number // 秒
  source: SourceType
  musicInfo: MusicInfo // 完整数据，用于获取播放 URL
}

/** interval（"mm:ss" / "h:mm:ss" / 数字）解析为秒 */
export function parseIntervalToSeconds(interval: string | number | undefined): number {
  if (!interval) return 0
  if (typeof interval === 'number') return interval
  const parts = String(interval).split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + (parts[1] || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0)
  const n = Number(interval)
  return isNaN(n) ? 0 : n
}

/** 从 {uid, musicInfo} 构建 Track。统一适配搜索/随机/收藏/历史/歌单的出口数据。 */
export function toTrack(input: { uid: string; musicInfo: MusicInfo }): Track {
  const mi = input.musicInfo
  return {
    uid: input.uid,
    name: mi.name,
    artist: mi.singer,
    album: mi.albumName || '',
    duration: parseIntervalToSeconds(mi.interval),
    source: mi.source,
    musicInfo: mi,
  }
}

export type { MusicInfo, QualityType, SourceType }
