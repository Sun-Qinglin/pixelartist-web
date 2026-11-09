import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 自动识别 Next.js,无需手动 output。
  // 注意:不要加 trailingSlash —— Route Handler 不支持尾部斜杠,
  // 会把 /api/license/redeem 重定向到 /api/license/redeem/ 导致 404。
  images: { unoptimized: true },
};

export default nextConfig;