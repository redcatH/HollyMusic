import Dexie, { Table } from 'dexie'
import type { MusicInfo } from './types/music'

export interface HistoryItem {
  id?: number
  musicInfo: MusicInfo
  playCount: number
  lastPlayedAt: number
  createdAt: number
}

class MusicPlayerDB extends Dexie {
  history!: Table<HistoryItem>

  constructor() {
    super('musicPlayerDB')
    this.version(1).stores({
      history: '++id, &musicInfo.songmid, lastPlayedAt, playCount, createdAt'
    })
  }
}

const db = new MusicPlayerDB()

export const historyDb = {
  async addOrUpdate(musicInfo: MusicInfo): Promise<number> {
    const songmid = musicInfo.songmid
    
    const existing = await db.history
      .where('musicInfo.songmid')
      .equals(songmid)
      .first()

    const now = Date.now()

    if (existing) {
      await db.history.update(existing.id!, {
        playCount: existing.playCount + 1,
        lastPlayedAt: now,
      })
      return existing.id!
    } else {
      const newItem: HistoryItem = {
        musicInfo,
        playCount: 1,
        lastPlayedAt: now,
        createdAt: now,
      }
      return await db.history.add(newItem)
    }
  },

  async getAll(sortBy: 'time' | 'count' = 'time'): Promise<HistoryItem[]> {
    let collection = db.history.orderBy('lastPlayedAt')

    if (sortBy === 'count') {
      collection = db.history.orderBy('playCount').reverse()
    } else {
      collection = db.history.orderBy('lastPlayedAt').reverse()
    }

    return await collection.toArray()
  },

  async remove(id: number): Promise<void> {
    await db.history.delete(id)
  },

  async clear(): Promise<void> {
    await db.history.clear()
  },

  async count(): Promise<number> {
    return await db.history.count()
  },
}

export default db
