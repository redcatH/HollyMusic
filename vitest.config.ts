import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Vitest 配置（根目录 · 后端测试）
 *
 * 覆盖范围：
 * - lib/server 下 *.test.ts         服务端工具单元测试
 * - app/api 下 route.test.ts        Next.js API 路由集成测试
 *
 * 前端测试（hooks/components）由 frontend/vitest.config.ts 单独配置，
 * 因为根 tsconfig.json 排除了 frontend/、components/、hooks/ 目录。
 *
 * @ 别名与根 tsconfig.json 对齐，指向仓库根目录。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    // 只跑根目录下的测试；前端测试在 frontend/ 下独立运行
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
