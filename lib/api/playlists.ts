/**
 * 歌单 API
 */

import { apiGet, apiPost, apiPatch, apiDelete } from './client'
import type { MusicInfo } from '@/lib/types/music'

export interface PlaylistImportResult {
  playlistId: number
  totalRows: number
  added: number
  duplicates: number
  qualityFallback: number
  songCount: number
}

export interface PlaylistSummary {
  id: number
  name: string
  comment: string | null
  owner: string | null
  username: string
  isPublic: boolean
  songCount: number
  duration: number | null
  coverArt: string | null
  coverSongUid: string | null
  createdAt: string
}

export interface PlaylistEntryItem {
  id: number
  position: number
  songId: string
  musicInfo: MusicInfo | null
  addedAt: string
  addedBy: string | null
}

export interface PlaylistDetail extends PlaylistSummary {
  entries: PlaylistEntryItem[]
  allowedUsers: string[]
}

export function listPlaylists(): Promise<{ list: PlaylistSummary[] }> {
  return apiGet('playlists')
}

export function getPlaylist(id: number): Promise<PlaylistDetail> {
  return apiGet(`playlists/${id}`)
}

export function createPlaylist(name: string): Promise<PlaylistSummary> {
  return apiPost('playlists', { name })
}

export function updatePlaylist(
  id: number,
  updates: { name?: string; comment?: string; public?: boolean }
): Promise<{ updated: boolean }> {
  return apiPatch(`playlists/${id}`, updates)
}

export function deletePlaylist(id: number): Promise<{ deleted: boolean }> {
  return apiDelete(`playlists/${id}`)
}

export function addSongsToPlaylist(
  id: number,
  songIds: string[]
): Promise<{ added: boolean }> {
  return apiPost(`playlists/${id}/songs`, { songIds })
}

export function removeSongsFromPlaylist(
  id: number,
  entryId: number
): Promise<{ removed: boolean }> {
  return apiDelete(`playlists/${id}/songs`, { entryId })
}

export async function importNeteaseCsv(
  file: File,
  options?: { name?: string; playlistId?: number },
): Promise<PlaylistImportResult> {
  const body = new FormData()
  body.set('file', file)
  body.set('mode', options?.playlistId ? 'append' : 'create')
  if (options?.name) body.set('name', options.name)
  if (options?.playlistId) body.set('playlistId', String(options.playlistId))
  const res = await fetch('/api/playlists/import', { method: 'POST', body })
  const json = await res.json() as { success: boolean; data?: PlaylistImportResult; error?: { message?: string } }
  if (!json.success || !json.data) throw new Error(json.error?.message || '导入失败')
  return json.data
}

export async function importQqPlaylist(input: string, name?: string): Promise<PlaylistImportResult> {
  const body = new FormData(); body.set('source', 'tx'); body.set('input', input); if (name) body.set('name', name)
  const res = await fetch('/api/playlists/import', { method: 'POST', body })
  const json = await res.json() as { success: boolean; data?: PlaylistImportResult; error?: { message?: string } }
  if (!json.success || !json.data) throw new Error(json.error?.message || '导入失败')
  return json.data
}
