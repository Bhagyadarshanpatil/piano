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

  async headers() {
    return [
      {
        // COOP + COEP enable SharedArrayBuffer, which onnxruntime-web uses for
        // multi-threaded WASM. Even in single-threaded mode (current default)
        // having these set means we can opt into threading later with one line.
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy',  value: 'require-corp' },
        ],
      },
      {
        // The samples CDN proxy must emit CORP so the browser allows it to be
        // fetched under COEP. This header is added by Next.js on the proxy
        // response — the origin server doesn't need to send it.
        source: '/samples-cdn/:path*',
        headers: [
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
      {
        // ONNX WASM binaries and the model file served from public/ also need
        // CORP so they load correctly under the COEP policy.
        source: '/(ort-wasm|basic-pitch-onnx)/:path*',
        headers: [
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ]
  },
};

export default nextConfig;
