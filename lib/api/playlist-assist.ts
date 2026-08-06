/**
 * AI 协助创建歌单 API 客户端
 * 面向所有登录用户，凭证由服务端环境变量持有，前端不传 key。
 */

import { apiGet, apiPost } from './client'

export type AiPlaylistMode = 'songs' | 'artists'

export interface AiPlaylistGenerateResult {
  mode: AiPlaylistMode
  items: string[]
  playlistName: string
}

export interface AiPlaylistFilterSong {
  uid: string
  name: string | null
  singer: string | null
  source: string
  albumName?: string | null
}

export interface AiPlaylistSuggestion {
  uid: string
  action: 'keep' | 'remove'
  reason: string
}

/** 获取当前启用的搜索音源平台列表 */
export function getSearchSources(): Promise<{ sources: string[] }> {
  return apiGet<{ sources: string[] }>('search-sources')
}

/** AI 生成歌单候选（自选 mode + 搜索词 + 歌单名），不写库 */
export function aiPlaylistGenerate(prompt: string): Promise<AiPlaylistGenerateResult> {
  return apiPost<AiPlaylistGenerateResult>('playlist-assist/generate', { prompt })
}

/** AI 过滤候选歌曲（只读建议 keep/remove + 原因），不写库 */
export function aiPlaylistFilter(
  songs: AiPlaylistFilterSong[],
  prompt?: string,
): Promise<{ suggestions: AiPlaylistSuggestion[] }> {
  return apiPost<{ suggestions: AiPlaylistSuggestion[] }>('playlist-assist/filter', {
    songs,
    prompt,
  })
}
