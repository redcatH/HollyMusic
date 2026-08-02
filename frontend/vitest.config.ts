import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Vitest 配置（前端测试）
 *
 * 覆盖范围：
 * - hooks 下 *.test.ts(x)          前端 hook 单元测试
 * - components 下 *.test.tsx       共享 UI 组件测试
 *
 * @ 别名与 frontend/vite.config.ts 对齐，指向仓库根目录，
 * 这样测试中 import { useDownload } from '@/hooks/useDownload' 可正确解析。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
      '@@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['hooks/**/*.test.ts', 'hooks/**/*.test.tsx', 'components/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
  },
})
