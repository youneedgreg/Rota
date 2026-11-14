import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (apps/web/Dockerfile).
  output: "standalone",
  // Trace files from the workspace root so @rota/receipts is included.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
