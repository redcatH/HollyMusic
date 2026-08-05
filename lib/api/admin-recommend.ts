/**
 * 推荐管理 API 客户端
 */

import { apiGet, apiPost, apiDelete } from './client'

export interface AdminRecommendSong {
  uid: string
  source: string
  name: string | null
  singer: string | null
  img: string | null
  albumName: string | null
  updatedAt: string // 后端 Date 经 JSON 序列化为 string
}

export function listRecommended(
  page = 1,
  limit = 50,
  opts?: { keyword?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' },
): Promise<{ list: AdminRecommendSong[]; total: number }> {
  return apiGet<{ list: AdminRecommendSong[]; total: number }>('admin/recommend', {
    page,
    limit,
    keyword: opts?.keyword,
    sortBy: opts?.sortBy,
    sortOrder: opts?.sortOrder,
  })
}

/** 批量加入推荐 */
export function addRecommended(uids: string[]): Promise<{ updated: number }> {
  return apiPost<{ updated: number }>('admin/recommend', { uids })
}

/** 取消单首推荐 */
export function removeRecommended(uid: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`admin/recommend/${encodeURIComponent(uid)}`)
}

/** 批量取消推荐 */
export function removeRecommendedBatch(uids: string[]): Promise<{ updated: number }> {
  return apiPost<{ updated: number }>('admin/recommend/batch-remove', { uids })
}
