/**
 * 登录锁定管理 API 客户端（admin）
 */

import { apiGet, apiPost } from './client'

export interface LoginLock {
  ip: string
  retryAfterSec: number
  failures: number
}

export function listLoginLocks(): Promise<{ locks: LoginLock[]; count: number }> {
  return apiGet<{ locks: LoginLock[]; count: number }>('admin/login-locks')
}

export function unlockLoginLock(ip: string): Promise<{ ip: string; unlocked: boolean }> {
  return apiPost<{ ip: string; unlocked: boolean }>('admin/login-locks', { action: 'unlock', ip })
}

export function clearAllLoginLocks(): Promise<{ cleared: number }> {
  return apiPost<{ cleared: number }>('admin/login-locks', { action: 'clearAll' })
}
