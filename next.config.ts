import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/samples-cdn/:path*',
        destination: 'https://samples.notefall.app/:path*',
      },
    ]
  },
};

export default nextConfig;
