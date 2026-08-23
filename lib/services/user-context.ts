/**
 * 请求用户上下文解析
 *
 * 入口：getAuthState / requireUser / requireAdmin，基于签名 cookie 的鉴权，
 * 用于受保护路由。公开路由（分享落地页链路、auth、health）不解析用户。
 */

import { NextRequest } from 'next/server'
import { PrismaClient } from '../generated/prisma'
import { verifySession } from './auth'
import { logger } from '../logger'

const prisma = new PrismaClient()

export interface RequestUser {
  id: number
  username: string
}

export interface AuthState {
  authenticated: boolean
  user: RequestUser | null
  /** 是否需要强制修改密码（首次登录/弱口令重置后为 true） */
  mustChangePassword: boolean
}

/**
 * 鉴权错误：受保护路由未登录时抛出，由 route 捕获返回 401。
 */
export class AuthError extends Error {
  statusCode = 401
  constructor(message = '未登录') {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * 权限不足错误：已登录但非管理员访问管理路由时抛出，由 route 捕获返回 403。
 */
export class ForbiddenError extends Error {
  statusCode = 403
  constructor(message = '权限不足') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** 管理员用户名约定（与 config/users.json 的 admin 兼容） */
const ADMIN_USERNAME = 'admin'

/**
 * 判断用户名是否为管理员（当前约定：username === 'admin'）。
 */
export function isAdmin(username: string | null | undefined): boolean {
  return !!username && username === ADMIN_USERNAME
}

/**
 * 解析请求的鉴权状态（基于签名 cookie）。
 * 已登录时保证返回持久化的 user；未登录返回 { authenticated:false, user:null }。
 *
 * 两道失效防线（均零额外查询，User 行本就按需加载）：
 * 1. cookie 中的 sessionVersion 必须与 User.sessionVersion 一致 —— 改密码/管理员重置后
 *    版本递增，该用户所有旧会话立即失效；
 * 2. 用户行只读不建 —— 用户被管理员删除后，残留 cookie 判定未登录，
 *    不再像旧逻辑那样经 getOrCreateUserByName 自动重建无密码行。
 */
export async function getAuthState(request: NextRequest): Promise<AuthState> {
  const session = verifySession(request)
  if (!session.authenticated || !session.username) {
    return { authenticated: false, user: null, mustChangePassword: false }
  }
  try {
    const u = await prisma.user.findUnique({ where: { username: session.username } })
    if (!u) {
      logger.warn(`[user-context] 会话用户已不存在，判定未登录: ${session.username}`)
      return { authenticated: false, user: null, mustChangePassword: false }
    }
    if (session.sessionVersion !== u.sessionVersion) {
      logger.info(`[user-context] 会话版本不匹配（cookie=${session.sessionVersion} db=${u.sessionVersion}），旧会话已失效: ${u.username}`)
      return { authenticated: false, user: null, mustChangePassword: false }
    }
    return { authenticated: true, user: { id: u.id, username: u.username }, mustChangePassword: !!u.mustChangePassword }
  } catch (e) {
    logger.error('[user-context] getAuthState: 查询用户失败', e)
    return { authenticated: false, user: null, mustChangePassword: false }
  }
}

/**
 * 要求已登录，否则抛 AuthError(401)。
 * 受保护路由入口调用。
 */
export async function requireUser(request: NextRequest): Promise<RequestUser> {
  const state = await getAuthState(request)
  if (!state.authenticated || !state.user) {
    throw new AuthError()
  }
  return state.user
}

/**
 * 要求已登录且为管理员（username === 'admin'），否则抛 AuthError(401) 或 ForbiddenError(403)。
 * 管理路由入口调用。
 */
export async function requireAdmin(request: NextRequest): Promise<RequestUser> {
  const user = await requireUser(request)
  if (!isAdmin(user.username)) {
    throw new ForbiddenError()
  }
  return user
}

const userContextApi = { getAuthState, requireUser, requireAdmin, isAdmin, AuthError, ForbiddenError }
export default userContextApi
