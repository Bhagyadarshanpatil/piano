import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
