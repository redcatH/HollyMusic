/**
 * 服务端启动钩子。
 *
 * Docker 入口会先完成 Prisma migration，再启动 Next.js；因此这里的用户初始化
 * 既不会在构建期执行，也不会早于数据库 schema 就绪。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const [{ ensureInitialAdmin, syncUsersFromConfig }, { logger }] = await Promise.all([
    import('@/lib/config-sync'),
    import('@/lib/logger'),
  ])

  const syncResult = await syncUsersFromConfig()
  const adminResult = await ensureInitialAdmin()
  logger.info(
    `[startup] 用户初始化完成: imported=${syncResult.imported} initialAdminCreated=${adminResult.created}`,
  )
}
