import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // This app sits inside the package repository, which has its own lockfile
  turbopack: { root: import.meta.dirname },
  serverExternalPackages: ["@libsql/client", "libsql"],
  // Measurements are counted under the page that is shown, not under the address:
  // /share/abc123 as /shared, /u/hello-world as /blog/[slug]
  rewrites: async () => [
    { source: "/share/:token", destination: "/shared" },
    { source: "/u/:name", destination: "/blog/:name" },
  ],
};

export default nextConfig;
