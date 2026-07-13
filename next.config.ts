import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "politicsandwar.com" },
      { protocol: "https", hostname: "*.politicsandwar.com" },
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
