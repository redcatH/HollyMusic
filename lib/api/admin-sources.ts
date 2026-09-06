/**
 * 音源管理 API 客户端
 */

import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client'
import type { SourceConfig } from '@/lib/types/music'

export interface AdminSource extends SourceConfig {
  scriptExists: boolean
}

export function listSources(): Promise<{ list: AdminSource[] }> {
  return apiGet<{ list: AdminSource[] }>('admin/sources')
}

export function createSource(opts: {
  path: string
  name?: string
  description?: string
  priority?: number
  timeout?: number
  enabled?: boolean
  pt?: string[]
}): Promise<SourceConfig> {
  return apiPost<SourceConfig>('admin/sources', opts)
}

export function updateSource(
  sourcePath: string,
  opts: {
    name?: string
    description?: string
    priority?: number
    timeout?: number
    enabled?: boolean
    pt?: string[]
  }
): Promise<SourceConfig> {
  return apiPut<SourceConfig>(`admin/sources/${encodeURIComponent(sourcePath)}`, opts)
}

/**
 * 批量更新源配置（服务端一次写入 + 一次 reload）。
 * 供列表批量启停与平台矩阵单元格切换使用。
 */
export function bulkUpdateSources(
  updates: Array<{ path: string; enabled?: boolean; pt?: string[]; priority?: number }>
): Promise<{ updated: number }> {
  return apiPatch<{ updated: number }>('admin/sources', { updates })
}

export function deleteSource(sourcePath: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`admin/sources/${encodeURIComponent(sourcePath)}`)
}

/** 从在线洛雪链接导入脚本，并注册为可手动更新的订阅。 */
export function importSourceSubscription(url: string): Promise<SourceConfig> {
  return apiPost<SourceConfig>('admin/sources/subscriptions', { url })
}

/** 手动拉取已订阅脚本的最新内容。 */
export function updateSourceSubscription(sourcePath: string): Promise<SourceConfig> {
  return apiPost<SourceConfig>(`admin/sources/${encodeURIComponent(sourcePath)}`)
}

/**
 * 上传音源脚本文件。
 * 成功后自动注册到 music-sources.json。
 */
export async function uploadScript(file: File): Promise<SourceConfig> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch('/api/admin/sources/upload', {
    method: 'POST',
    body: formData,
    // 不要手动设 Content-Type，浏览器会自动加 boundary
  })

  const json = await res.json()
  if (!json.success || json.data === undefined) {
    throw new Error(json.error?.message || '上传失败')
  }
  return json.data as SourceConfig
}
