/**
 * 服务端启动钩子。
 *
 * Docker 入口会先完成 Prisma migration，再启动 Next.js；因此这里的用户初始化
 * 既不会在构建期执行，也不会早于数据库 schema 就绪。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return

  const [{ ensureInitialAdmin, syncUsersFromConfig }, { getInitializationStatus }, { logger }] = await Promise.all([
    import('@/lib/config-sync'),
    import('@/lib/services/initialization'),
    import('@/lib/logger'),
  ])

  const syncResult = await syncUsersFromConfig()
  let status = await getInitializationStatus()
  // 保留显式 users.json 仅包含普通用户时的历史管理员兜底行为。
  if (syncResult.imported > 0 && status.setupRecoveryRequired) {
    await ensureInitialAdmin()
    status = await getInitializationStatus()
  }
  logger.info(
    `[startup] 用户配置就绪: imported=${syncResult.imported} setupRequired=${status.setupRequired}`,
  )
  if (status.setupRequired) logger.info('[startup] 请打开网站设置管理员密码，完成首次初始化。')
  if (status.setupRecoveryRequired) logger.warn('[startup] 历史数据缺少管理员，初始化入口已关闭，请恢复管理员或数据库备份。')
}
