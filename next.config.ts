import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // No cacheComponents: every page reads the session, so nothing here
  // prerenders, and the model would only ask for Suspense around each read.
  output: "standalone",
  // Only the viewer itself and the lab's Nextcloud (the winlab_viewer app)
  // may show these pages in a frame.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: `frame-ancestors 'self' ${process.env.NEXTCLOUD_FRAME_ORIGIN ?? "https://nextcloud.winlab.tw"}`,
        },
      ],
    },
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
