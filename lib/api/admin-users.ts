/**
 * 用户管理 API 客户端
 */

import { apiGet, apiPost, apiPut, apiDelete } from './client'

export interface AdminUser {
  id: number
  username: string
  isAdmin: boolean
  hasPassword: boolean
  lastLogin: string | null
  lastSeen: string | null
  lastSeenIp: string | null
  lastSeenUa: string | null
  isOnline: boolean
  createdAt: string
  updatedAt: string
}

export function listUsers(): Promise<{ list: AdminUser[] }> {
  return apiGet<{ list: AdminUser[] }>('admin/users')
}

export function createUser(username: string, password: string): Promise<AdminUser> {
  return apiPost<AdminUser>('admin/users', { username, password })
}

export function updateUser(
  id: number,
  opts: { username?: string; password?: string }
): Promise<AdminUser> {
  return apiPut<AdminUser>(`admin/users/${id}`, opts)
}

export function deleteUser(id: number): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`admin/users/${id}`)
}
