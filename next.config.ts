import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['needle', 'tunnel'],
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
