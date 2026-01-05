import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do NOT use output: 'export' with @cloudflare/next-on-pages
  // next-on-pages builds the app for Cloudflare Pages and supports edge runtime
  output: undefined,
  images: {
    unoptimized: true, // Required for static export
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_QUEST_API_URL: process.env.NEXT_PUBLIC_QUEST_API_URL,
    NEXT_PUBLIC_RUNTIME_API_URL: process.env.NEXT_PUBLIC_RUNTIME_API_URL,
    NEXT_PUBLIC_RUNTIME_WS_URL: process.env.NEXT_PUBLIC_RUNTIME_WS_URL,
    RUNTIME_API_URL: process.env.RUNTIME_API_URL,
    RUNTIME_WS_URL: process.env.RUNTIME_WS_URL,
    CLOUDFLARE_ACCOUNT_HASH: process.env.CLOUDFLARE_ACCOUNT_HASH,
    CLOUDFLARE_STREAM_CUSTOMER_CODE: process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE,
  },
};

export default nextConfig;
