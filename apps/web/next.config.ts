import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** The relay's origin, when it's a local ws:// one that "wss:" below wouldn't cover. */
function localRelay(): string {
  const url = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://localhost:7777";
  return url.startsWith("ws://") ? ` ${new URL(url).origin.replace(/^http/, "ws")}` : "";
}

/**
 * Scripts only from Rota itself. Pages are pre-rendered, so Next's inline
 * scripts need 'unsafe-inline' (no per-request nonce); 'wasm-unsafe-eval' is
 * for the Breez wallet's WebAssembly. Connections stay open to any https/wss
 * address: members pay arbitrary Lightning addresses and use their own relay.
 * No upgrade-insecure-requests: it would turn the local ws:// relay into wss://.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' https: wss:${localRelay()}${isDev ? " ws://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
