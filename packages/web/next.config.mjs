import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const wardenUrl = process.env.NEXT_PUBLIC_WARDEN_URL;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // When NEXT_PUBLIC_WARDEN_URL is unset (local dev), proxy API calls to the
  // Warden server on localhost so the pages can keep using relative fetch("/matches") etc.
  async rewrites() {
    if (wardenUrl) return [];
    const target = "http://localhost:4000";
    return [
      { source: "/matches", destination: `${target}/matches` },
      { source: "/ledger", destination: `${target}/ledger` },
      { source: "/health", destination: `${target}/health` },
      { source: "/events", destination: `${target}/events` },
      { source: "/match/:path*", destination: `${target}/match/:path*` },
    ];
  },
};

export default nextConfig;
