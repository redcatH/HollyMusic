/**
 * 用户管理服务
 *
 * 管理员对用户的 CRUD 操作。所有写操作都带业务保护：
 * - admin 账户（username === 'admin'）不可删除、不可改用户名
 * - 禁止当前登录用户删除自己
 * - 用户名唯一约束
 *
 * 密码仍以明文存于 User.subsonicSecret（与 Subsonic t 校验兼容），不在此处做哈希。
 */

import { PrismaClient } from '../generated/prisma'
import { logger } from '../logger'
import { ONLINE_TTL_MS } from '../user'

const prisma = new PrismaClient()

export interface AdminUserView {
  id: number
  username: string
  /** 是否管理员（仅 username === 'admin'） */
  isAdmin: boolean
  /** 是否设置了密码（不返回密码本身） */
  hasPassword: boolean
  /** 是否需要强制修改密码（管理员重置密码后置 true） */
  mustChangePassword: boolean
  lastLogin: Date | null
  /** 最近一次活跃时间（登录/心跳） */
  lastSeen: Date | null
  /** 最近一次活跃的客户端 IP */
  lastSeenIp: string | null
  /** 最近一次活跃的 User-Agent */
  lastSeenUa: string | null
  /** 是否在线（最近活跃在 ONLINE_TTL_MS 内） */
  isOnline: boolean
  createdAt: Date
  updatedAt: Date
}

/** 安全用户视图：脱敏，不含密码字段 */
function toView(u: {
  id: number
  username: string
  subsonicSecret: string | null
  mustChangePassword: boolean
  lastLogin: Date | null
  lastSeen: Date | null
  lastSeenIp: string | null
  lastSeenUa: string | null
  createdAt: Date
  updatedAt: Date
}): AdminUserView {
  return {
    id: u.id,
    username: u.username,
    isAdmin: u.username === 'admin',
    hasPassword: !!u.subsonicSecret,
    mustChangePassword: !!u.mustChangePassword,
    lastLogin: u.lastLogin,
    lastSeen: u.lastSeen,
    lastSeenIp: u.lastSeenIp,
    lastSeenUa: u.lastSeenUa,
    isOnline: !!(u.lastSeen && Date.now() - u.lastSeen.getTime() < ONLINE_TTL_MS),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }
}

export async function listUsers(): Promise<AdminUserView[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ username: 'asc' }],
  })
  return users.map(toView)
}

export async function getUserById(id: number): Promise<AdminUserView | null> {
  const u = await prisma.user.findUnique({ where: { id } })
  return u ? toView(u) : null
}

/**
 * 新建用户。
 * @throws UserInputError 用户名已存在 / 为空
 */
export async function createUser(username: string, password: string): Promise<AdminUserView> {
  const name = (username || '').trim()
  if (!name) throw new UserInputError('用户名不能为空')
  if (!password) throw new UserInputError('密码不能为空')

  try {
    const u = await prisma.user.create({
      data: { username: name, subsonicSecret: password },
    })
    logger.info(`[user-service] 新建用户: ${name}`)
    return toView(u)
  } catch (e) {
    // P2002 = unique constraint violation
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      throw new UserInputError(`用户名 "${name}" 已存在`)
    }
    throw e
  }
}

/**
 * 更新用户。username 可选；若提供 password 则更新密码，否则保留原密码。
 *
 * 保护规则：
 * - admin 账户（原 username === 'admin'）不可改用户名（防丢管理员）
 * - 改用户名时检查新名唯一
 *
 * @throws NotFoundError 用户不存在
 * @throws UserInputError 改名冲突 / admin 改名
 */
export async function updateUser(
  id: number,
  opts: { username?: string; password?: string | null }
): Promise<AdminUserView> {
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('用户不存在')

  const data: { username?: string; subsonicSecret?: string | null; mustChangePassword?: boolean } = {}

  if (opts.username != null) {
    const newName = opts.username.trim()
    if (!newName) throw new UserInputError('用户名不能为空')
    if (newName !== existing.username) {
      // admin 账户禁止改名
      if (existing.username === 'admin') {
        throw new UserInputError('管理员账户不可更改用户名')
      }
      data.username = newName
    }
  }

  // password === null / '' 表示不改；显式传非空字符串才更新
  if (typeof opts.password === 'string' && opts.password !== '') {
    data.subsonicSecret = opts.password
    // 管理员重置某用户密码后，强制该用户下次登录改密
    data.mustChangePassword = true
  }

  if (Object.keys(data).length === 0) {
    // 无变更
    return toView(existing)
  }

  try {
    const u = await prisma.user.update({ where: { id }, data })
    logger.info(`[user-service] 更新用户 id=${id} keys=${Object.keys(data).join(',')}`)
    return toView(u)
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      throw new UserInputError(`用户名 "${data.username}" 已存在`)
    }
    throw e
  }
}

/**
 * 删除用户。
 *
 * 保护规则：
 * - admin 账户（username === 'admin'）不可删除
 * - 禁止删除自己（currentUsername 校验）
 *
 * 关联数据：Playlist/PlayHistory 用 username 做外键，onDelete: Cascade，会级联删除其歌单；
 * Favorite 用 userId，同样 Cascade。
 *
 * @throws NotFoundError 用户不存在
 * @throws UserInputError admin 账户 / 删除自己
 */
export async function deleteUser(id: number, currentUsername: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('用户不存在')

  if (existing.username === 'admin') {
    throw new UserInputError('管理员账户不可删除')
  }
  if (existing.username === currentUsername) {
    throw new UserInputError('不能删除当前登录的自己')
  }

  await prisma.user.delete({ where: { id } })
  logger.info(`[user-service] 删除用户: ${existing.username} (by ${currentUsername})`)
}

/** 业务层输入错误（4xx） */
export class UserInputError extends Error {
  statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'UserInputError'
  }
}

/** 业务层未找到（404） */
export class NotFoundError extends Error {
  statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

const userService = { listUsers, getUserById, createUser, updateUser, deleteUser }
export default userService
