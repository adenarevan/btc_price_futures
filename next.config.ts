import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE === "true") {
  throw new Error("DEMO_MODE=true is forbidden in production builds.");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "64kb",
    },
  },
};

export default nextConfig;
