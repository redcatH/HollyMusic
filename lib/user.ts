import { PrismaClient } from './generated/prisma'
import type { NextRequest } from 'next/server'

const prisma = new PrismaClient()

/** 在线判定阈值：最近一次活跃在此时间内视为在线 */
export const ONLINE_TTL_MS = 5 * 60 * 1000

/**
 * 从请求头解析客户端 IP。
 * 优先取 X-Forwarded-For 首段（nginx 已设置 proxy_add_x_forwarded_for），回退 X-Real-IP。
 */
export function getClientIp(request: NextRequest): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const ip = xff.split(',')[0]?.trim()
    if (ip) return ip
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

/**
 * 取 User-Agent，截断 255 字符防超长入库。
 */
export function getUa(request: NextRequest): string | null {
  const ua = request.headers.get('user-agent')
  return ua ? ua.slice(0, 255) : null
}

export async function updateLastLoginByUsername(username: string) {
  if (!username) return null
  try {
    const u = await prisma.user.findUnique({ where: { username } })
    if (!u) return null
    const updated = await prisma.user.update({ where: { id: u.id }, data: { lastLogin: new Date() } })
    return updated
  } catch (e) {
    console.warn('user.updateLastLoginByUsername error', e)
    return null
  }
}

/**
 * 更新用户的最近活跃信息（时间 + IP + UA），best-effort。
 * 登录与心跳均调用，用于在线状态推断。
 */
export async function updateLastSeenByUsername(
  username: string,
  ip: string | null,
  ua: string | null,
) {
  if (!username) return null
  try {
    const u = await prisma.user.findUnique({ where: { username } })
    if (!u) return null
    const updated = await prisma.user.update({
      where: { id: u.id },
      data: { lastSeen: new Date(), lastSeenIp: ip, lastSeenUa: ua },
    })
    return updated
  } catch (e) {
    console.warn('user.updateLastSeenByUsername error', e)
    return null
  }
}

const userApi = { updateLastLoginByUsername, updateLastSeenByUsername, getClientIp, getUa }
export default userApi
