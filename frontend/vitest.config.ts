import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'

const routerRequire = createRequire(realpathSync(path.resolve(__dirname, 'node_modules/react-router-dom/package.json')))

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
      // 共享组件/Zustand 从根目录加载，测试 renderer 必须使用同一份 React。
      react: path.resolve(__dirname, '../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
      // 使用 ESM 入口，让 Router 内部的 React 导入也经过共享别名。
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom/dist/index.mjs'),
      'react-router/dom': routerRequire.resolve('react-router/dom').replace(/\.js$/, '.mjs'),
      'react-router': routerRequire.resolve('react-router').replace(/index\.js$/, 'index.mjs'),
    },
  },
  test: {
    // Router 也走 Vite 解析，确保其 React 使用上面的共享别名。
    server: { deps: { inline: [/react-router/] } },
    include: ['hooks/**/*.test.ts', 'hooks/**/*.test.tsx', 'components/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
  },
})
