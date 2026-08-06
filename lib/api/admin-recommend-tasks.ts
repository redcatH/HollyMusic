/**
 * 推荐任务管理 API 客户端
 */

import { apiGet, apiPost, apiDelete } from './client'
import type { RecommendTaskView, TaskConfig, TaskStatus, TaskType } from '@/lib/types/recommend-task'

export type { RecommendTaskView, TaskConfig, TaskProgress, ArtistResult, TaskStatus, TaskType } from '@/lib/types/recommend-task'

export function listRecommendTasks(
  page = 1,
  limit = 50,
  status?: TaskStatus,
): Promise<{ list: RecommendTaskView[]; total: number }> {
  return apiGet<{ list: RecommendTaskView[]; total: number }>('admin/recommend-tasks', { page, limit, status })
}

export function createRecommendTask(input: {
  name: string
  taskType: TaskType
  artists: string[]
  config: Partial<TaskConfig>
  apiKey: string
}): Promise<RecommendTaskView> {
  return apiPost<RecommendTaskView>('admin/recommend-tasks', input)
}

export function getRecommendTask(id: string): Promise<RecommendTaskView> {
  return apiGet<RecommendTaskView>(`admin/recommend-tasks/${encodeURIComponent(id)}`)
}

export function rerunRecommendTask(
  id: string,
  input: { apiKey: string; config?: Partial<TaskConfig> },
): Promise<RecommendTaskView> {
  return apiPost<RecommendTaskView>(`admin/recommend-tasks/${encodeURIComponent(id)}/rerun`, input)
}

export function cancelRecommendTask(id: string): Promise<RecommendTaskView> {
  return apiPost<RecommendTaskView>(`admin/recommend-tasks/${encodeURIComponent(id)}/cancel`)
}

export function deleteRecommendTask(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`admin/recommend-tasks/${encodeURIComponent(id)}`)
}

/** AI 协助生成歌手/歌曲名单（不写库） */
export function aiGenerateList(opts: {
  taskType: TaskType
  prompt: string
  apiKey: string
  baseUrl?: string
  model?: string
  extraBody?: Record<string, unknown>
}): Promise<{ items: string[] }> {
  return apiPost<{ items: string[] }>('admin/recommend-tasks/ai-generate', opts)
}
