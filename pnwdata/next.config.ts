import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
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
