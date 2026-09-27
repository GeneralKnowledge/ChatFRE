import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@libsql/client",
    "@libsql/darwin-x64",
    "@libsql/linux-x64-gnu",
    "libsql",
  ],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
