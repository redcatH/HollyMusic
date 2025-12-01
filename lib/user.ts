import { PrismaClient } from './generated/prisma'

const prisma = new PrismaClient()

export async function updateLastLoginByUsername(username: string) {
  if (!username) return null
  try {
    const u = await prisma.user.findUnique({ where: { username } })
    if (!u) return null
    const updated = await prisma.user.update({ where: { id: u.id }, data: ({ lastLogin: new Date() } as any) })
    return updated
  } catch (e) {
    console.warn('user.updateLastLoginByUsername error', e)
    return null
  }
}

export default { updateLastLoginByUsername }
