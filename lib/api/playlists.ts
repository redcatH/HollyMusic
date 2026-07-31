/**
 * 歌单 API
 */

import { apiGet, apiPost, apiPatch, apiDelete } from './client'
import type { MusicInfo } from '@/lib/types/music'

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
  createdAt: string
}

export interface PlaylistEntryItem {
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
  positions: number[]
): Promise<{ removed: boolean }> {
  return apiDelete(`playlists/${id}/songs`, { positions: positions.join(',') })
}
