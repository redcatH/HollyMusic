import { apiGet } from './client'
import type { DiscoveryCollectionDetail, DiscoveryPlaylist, DiscoveryPlaylistFilter, DiscoverySource, DiscoveryToplist } from '@/lib/services/discovery-service'

export function getToplists(source: DiscoverySource = 'tx'): Promise<DiscoveryToplist[]> {
  return apiGet('discover/toplists', { source })
}

export function getToplistDetail(source: DiscoverySource, id: string): Promise<DiscoveryCollectionDetail> {
  return apiGet(`discover/toplists/${encodeURIComponent(id)}`, { source })
}

export function getRecommendedPlaylists(source: DiscoverySource = 'tx', limit = 12, page = 1, filter: DiscoveryPlaylistFilter = {}): Promise<DiscoveryPlaylist[]> {
  return apiGet('discover/playlists', { source, limit, page, ...filter })
}

export function getRecommendedPlaylistDetail(source: DiscoverySource, id: string): Promise<DiscoveryCollectionDetail> {
  return apiGet(`discover/playlists/${encodeURIComponent(id)}`, { source })
}
