import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: process.env.API_URL 
          ? `${process.env.API_URL}/api/:path*` 
          : "http://backend:8002/api/:path*",
      },
    ];
  },
};

export default nextConfig;
