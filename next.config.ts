import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 启用 standalone 输出，生成最小化运行时（.next/standalone 含 server.js + 最小 node_modules）
  // 配合 Dockerfile 可将镜像从 ~800MB 瘦身到 ~250MB
  output: "standalone",

  // needle/tunnel 被 lib/music-core/*.js 顶层 require，必须外置（不打包进 bundle）
  serverExternalPackages: ['needle', 'tunnel'],

  // 强制把以下文件纳入 standalone 文件追踪（默认基于 import 静态分析会漏掉非 JS 资源）
  // - Prisma 客户端 + 查询引擎二进制（自定义 output 路径，.node 不是 JS import）
  // - Prisma CLI（运行时 migrate deploy 需要，但不被 app 代码 import）
  // - needle/tunnel 兜底（serverExternalPackages 在 Turbopack 下追踪不可靠）
  outputFileTracingIncludes: {
    '/api/**': [
      './lib/generated/prisma/**/*',
      './prisma/**/*',
      './node_modules/prisma/**/*',
      './node_modules/@prisma/**/*',
      './node_modules/needle/**/*',
      './node_modules/tunnel/**/*',
    ],
    '/rest/**': [
      './lib/generated/prisma/**/*',
      './prisma/**/*',
    ],
  },

  async rewrites() {
    return [
      // Only rewrite the stream endpoint to the Pages API adapter.
      // Keep other /rest/* routes handled by the App Router (app/rest/[method]/route.ts).
      // {
      //   source: '/rest/stream',
      //   destination: '/api/rest/stream',
      // },
      // {
      //   source: '/rest/stream/:path*',
      //   destination: '/api/rest/stream/:path*',
      // },
    ]
  },
};

export default nextConfig;
