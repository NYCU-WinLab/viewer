import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // No cacheComponents: every page reads the session, so nothing here
  // prerenders, and the model would only ask for Suspense around each read.
  output: "standalone",
  // Only the viewer itself and the lab's Nextcloud (the winlab_viewer app)
  // may show these pages in a frame; sign-in and the MCP consent page only
  // the viewer itself.
  headers: async () => [
    {
      source: "/((?!sign-in|consent).*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: `frame-ancestors 'self' ${process.env.NEXTCLOUD_FRAME_ORIGIN ?? "https://nextcloud.winlab.tw"}`,
        },
      ],
    },
    {
      source: "/:page(sign-in|consent)/:rest*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
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
