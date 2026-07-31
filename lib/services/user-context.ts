/**
 * 请求用户上下文解析
 *
 * 提供两套入口：
 * - getAuthState / requireUser：基于签名 cookie 的鉴权，用于受保护路由（收藏/歌单/历史/下载）。
 * - getRequestUser：兼容旧逻辑，匿名也能解析出默认 admin，仅用于公开路由或过渡。
 *
 * 用户持久化复用 favorites.getOrCreateUserByName（与 config/users.json 的 admin 兼容）。
 */

import { NextRequest } from 'next/server'
import { getOrCreateUserByName } from '../favorites'
import { verifySession } from './auth'
import { logger } from '../logger'

const DEFAULT_USERNAME = process.env.DEFAULT_USERNAME || 'admin'

export interface RequestUser {
  id: number
  username: string
}

export interface AuthState {
  authenticated: boolean
  user: RequestUser | null
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
 */
export async function getAuthState(request: NextRequest): Promise<AuthState> {
  const session = verifySession(request)
  if (!session.authenticated || !session.username) {
    return { authenticated: false, user: null }
  }
  try {
    const u = await getOrCreateUserByName(session.username)
    return { authenticated: true, user: { id: u.id, username: u.username } }
  } catch (e) {
    logger.error('[user-context] getAuthState: 持久化用户失败', e)
    return { authenticated: false, user: null }
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

/**
 * 兼容入口：解析当前请求的用户，未登录时回落到默认 admin。
 * 仅用于公开路由（搜索/播放等不需要隔离的场景）。
 *
 * 优先级：签名 cookie（已登录）> 默认 admin
 */
export async function getRequestUser(request: NextRequest): Promise<RequestUser> {
  const session = verifySession(request)
  const username = (session.username || DEFAULT_USERNAME).trim()
  const user = await getOrCreateUserByName(username)
  logger.debug(`[user-context] resolved user: ${user.username} (${user.id})`)
  return { id: user.id, username: user.username }
}

const userContextApi = { getAuthState, requireUser, requireAdmin, isAdmin, getRequestUser, AuthError, ForbiddenError }
export default userContextApi
