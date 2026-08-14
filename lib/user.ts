import { PrismaClient } from './generated/prisma'
import type { NextRequest } from 'next/server'

const prisma = new PrismaClient()

/** 在线判定阈值：最近一次活跃在此时间内视为在线 */
export const ONLINE_TTL_MS = 5 * 60 * 1000

/**
 * 是否信任反向代理转发头（X-Forwarded-For / X-Real-IP）。
 * 直连部署（默认 false）：这些头完全由客户端控制，若被信任可伪造 XFF 绕过登录限速。
 * 反代部署（true）：取 XFF 最后一段（nginx proxy_add_x_forwarded_for 追加的真实
 * remote_addr；首段是客户端可伪造的）。
 */
function trustProxy(): boolean {
  return (process.env.TRUST_PROXY ?? '').trim().toLowerCase() === 'true'
}

/**
 * 从请求头解析客户端 IP。
 * TRUST_PROXY=false（默认，直连）：忽略 XFF/X-Real-IP，返回 null。
 * TRUST_PROXY=true（反代）：优先 XFF 最后一段，回退 X-Real-IP。
 */
export function getClientIp(request: NextRequest): string | null {
  if (!trustProxy()) return null
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    const ip = parts[parts.length - 1]
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
