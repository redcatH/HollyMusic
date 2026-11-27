import { apiGet, apiPost } from './client'
import type { PluginAdminView, PluginChangeView, PluginDeletionScope, PluginImportResult, PluginTestResult } from '@/lib/platform-plugin-admin'
import type { PluginCapability, PublicPlatform } from '@/lib/platform-plugins'
import type { CatalogItem } from '@/lib/server/platform-plugin-contract'
import type { ApiResponse, Song } from '@/lib/types/music'

export interface PlatformCatalogPage<T> { items: T[]; hasMore: boolean; total?: number; nextCursor?: string; collection?: CatalogItem }

export const getPlatformList = (signal?: AbortSignal) => apiGet<PublicPlatform[]>('platforms', undefined, signal)

export function getPlatformCatalog<T extends CatalogItem | Song>(source: string, capability: PluginCapability,
  params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<PlatformCatalogPage<T>> {
  return apiGet('platforms/catalog', { ...params, source, capability }, signal)
}

export const getPluginAdmin = (signal?: AbortSignal) => apiGet<PluginAdminView>('admin/platform-plugins', undefined, signal)
export const testPlugin = (revisionId: string, platform: string, capability: PluginCapability, sample: string) =>
  apiPost<PluginTestResult>('admin/platform-plugins', { action: 'test', revisionId, platform, capability, sample })
const operationId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), item => item.toString(16).padStart(8, '0')).join('')
export const applyPluginChanges = (changes: PluginChangeView[]) =>
  apiPost<PluginChangeView[]>('admin/platform-plugins', { action: 'apply', requestId: operationId(), changes })
export const rollbackPluginChanges = (rollbackId: string) =>
  apiPost<PluginChangeView[]>('admin/platform-plugins', { action: 'apply', requestId: operationId(), rollbackId })
export const deletePlugin = (revisionId: string, scope: PluginDeletionScope) =>
  apiPost<{ deleted: number }>('admin/platform-plugins', { action: 'delete', revisionId, scope })

export async function uploadPlugin(file: File): Promise<PluginImportResult> {
  const response = await fetch('/api/admin/platform-plugins', { method: 'POST', headers: { 'Content-Type': 'text/javascript' }, body: file })
  const body: ApiResponse<PluginImportResult> = await response.json()
  if (!body.success || !body.data) throw new Error(body.error?.message || '上传失败')
  return body.data
}
